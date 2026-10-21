import { randomUUID } from 'crypto';
import { safeEqual, verifierChallenge } from '../common/crypto';
import { AuthException, ErrorCode } from '../common/errors';
import { KvStore } from '../kv/kv';

export type AuthIntent = 'login' | 'link' | 'reauth';
export type TransactionStatus = 'pending' | 'ready' | 'exchanged' | 'failed' | 'cancelled' | 'superseded';

export interface Transaction {
  id: string;
  state: string;
  nonce: string;
  verifierChallenge: string;
  intent: AuthIntent;
  userId?: string;
  deviceId?: string;
  status: TransactionStatus;
  ticket?: string;
  appleSub?: string;
  email?: string | null;
  isPrivateEmail?: boolean;
  name?: string | null;
  appleRefreshToken?: string | null;
  error?: string;
  createdAt: number;
}

interface TicketPayload {
  transactionId: string;
  verifierChallenge: string;
  intent: AuthIntent;
  userId?: string;
  appleSub: string;
  email: string | null;
  isPrivateEmail: boolean;
  name: string | null;
  appleRefreshToken: string | null;
}

export class TransactionStore {
  constructor(
    private readonly kv: KvStore,
    private readonly transactionTtlSec: number,
    private readonly ticketTtlSec: number,
  ) {}

  async create(input: {
    id?: string;
    state: string;
    nonce: string;
    verifierChallenge: string;
    intent: AuthIntent;
    userId?: string;
    deviceId?: string;
  }): Promise<Transaction> {
    if (input.deviceId) {
      const previousId = await this.kv.get(this.deviceKey(input.deviceId));
      if (previousId) {
        const previous = await this.read(previousId);
        if (previous && previous.status === 'pending') {
          previous.status = 'superseded';
          previous.error = 'SUPERSEDED';
          await this.write(previous);
          await this.kv.del(this.stateKey(previous.state));
        }
      }
    }

    const tx: Transaction = {
      id: input.id ?? randomUUID(),
      state: input.state,
      nonce: input.nonce,
      verifierChallenge: input.verifierChallenge,
      intent: input.intent,
      userId: input.userId,
      deviceId: input.deviceId,
      status: 'pending',
      createdAt: Date.now(),
    };
    await this.write(tx);
    await this.kv.set(this.stateKey(tx.state), tx.id, this.transactionTtlSec);
    if (tx.deviceId) await this.kv.set(this.deviceKey(tx.deviceId), tx.id, this.transactionTtlSec);
    return tx;
  }

  async takeByState(state: string): Promise<Transaction | null> {
    const id = await this.kv.getdel(this.stateKey(state));
    if (!id) return null;
    const tx = await this.read(id);
    if (!tx || tx.status !== 'pending') return null;
    return tx;
  }

  async markReady(
    tx: Transaction,
    profile: {
      userId?: string;
      appleSub: string;
      email: string | null;
      isPrivateEmail: boolean;
      name: string | null;
      appleRefreshToken: string | null;
    },
    ticket: string,
  ): Promise<void> {
    tx.status = 'ready';
    tx.userId = profile.userId ?? tx.userId;
    tx.ticket = ticket;
    tx.appleSub = profile.appleSub;
    tx.email = profile.email;
    tx.isPrivateEmail = profile.isPrivateEmail;
    tx.name = profile.name;
    tx.appleRefreshToken = profile.appleRefreshToken;
    await this.write(tx);
    const payload: TicketPayload = {
      transactionId: tx.id,
      verifierChallenge: tx.verifierChallenge,
      intent: tx.intent,
      userId: tx.userId,
      appleSub: profile.appleSub,
      email: profile.email,
      isPrivateEmail: profile.isPrivateEmail,
      name: profile.name,
      appleRefreshToken: profile.appleRefreshToken,
    };
    await this.kv.set(this.ticketKey(ticket), JSON.stringify(payload), this.ticketTtlSec);
  }

  async fail(tx: Transaction, status: 'failed' | 'cancelled', error: string): Promise<void> {
    tx.status = status;
    tx.error = error;
    await this.write(tx);
  }

  async status(transactionId: string, verifier?: string): Promise<{ status: string; ticket?: string }> {
    const tx = await this.read(transactionId);
    if (!tx) return { status: 'expired' };
    if (tx.status !== 'ready' || !tx.ticket || !verifier) return { status: tx.status };
    if (!safeEqual(verifierChallenge(verifier), tx.verifierChallenge)) return { status: tx.status };
    const ticketStillThere = await this.kv.get(this.ticketKey(tx.ticket));
    if (!ticketStillThere) return { status: 'exchanged' };
    return { status: 'ready', ticket: tx.ticket };
  }

  async consumeTicket(input: {
    ticket: string;
    verifier: string;
    transactionId: string;
    intent: AuthIntent;
  }): Promise<TicketPayload> {
    const raw = await this.kv.get(this.ticketKey(input.ticket));
    if (!raw) throw new AuthException(ErrorCode.TICKET_EXPIRED, '로그인 티켓이 만료되었거나 이미 사용되었습니다.');
    const payload = JSON.parse(raw) as TicketPayload;
    const challengeOk = safeEqual(verifierChallenge(input.verifier), payload.verifierChallenge);
    const bindingOk =
      payload.transactionId === input.transactionId && payload.intent === input.intent && challengeOk;
    if (!bindingOk) {
      throw new AuthException(ErrorCode.VERIFIER_MISMATCH, '로그인 요청과 티켓이 일치하지 않습니다.');
    }
    const deleted = await this.kv.getdel(this.ticketKey(input.ticket));
    if (!deleted) throw new AuthException(ErrorCode.TICKET_EXPIRED, '로그인 티켓이 만료되었거나 이미 사용되었습니다.');
    const tx = await this.read(input.transactionId);
    if (tx) {
      tx.status = 'exchanged';
      tx.ticket = undefined;
      await this.write(tx);
    }
    return payload;
  }

  private async read(id: string): Promise<Transaction | null> {
    const raw = await this.kv.get(this.txKey(id));
    return raw ? (JSON.parse(raw) as Transaction) : null;
  }

  private async write(tx: Transaction): Promise<void> {
    await this.kv.set(this.txKey(tx.id), JSON.stringify(tx), this.transactionTtlSec);
  }

  private txKey(id: string): string {
    return `apple:tx:${id}`;
  }

  private stateKey(state: string): string {
    return `apple:state:${state}`;
  }

  private ticketKey(ticket: string): string {
    return `apple:ticket:${ticket}`;
  }

  private deviceKey(deviceId: string): string {
    return `apple:device:${deviceId}`;
  }
}
