import { Inject, Injectable } from '@nestjs/common';
import { AppleClientSecretService, CONFIG } from '../apple/apple-client-secret.service';
import { AppleIdTokenVerifier } from '../apple/apple-id-token';
import { AppleOAuthClient } from '../apple/apple-oauth.client';
import { encryptString, decryptString } from '../common/encryption';
import { randomToken } from '../common/crypto';
import { AuthException, ErrorCode } from '../common/errors';
import { AppConfig } from '../config/config';
import { KvStore } from '../kv/kv';
import { KV } from '../kv/tokens';
import { nicknameFromApple, SocialRecord, UserRepo } from './records';
import { SessionService } from './session.service';
import { AuthIntent, Transaction, TransactionStore } from './transaction.store';
import { USER_REPO } from './tokens';

export interface PublicUser {
  id: string;
  nickname: string | null;
  email: string | null;
  isPrivateEmail: boolean;
  providerUserId: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(KV) private readonly kv: KvStore,
    @Inject(USER_REPO) private readonly users: UserRepo,
    private readonly transactions: TransactionStore,
    private readonly sessions: SessionService,
    private readonly clientSecret: AppleClientSecretService,
    private readonly verifier: AppleIdTokenVerifier,
    private readonly oauth: AppleOAuthClient,
  ) {}

  async start(
    input: { verifierChallenge: string; intent?: AuthIntent; deviceId?: string },
    userId: string | undefined,
    ip: string,
  ) {
    await this.rateLimit(ip, 'start');
    const intent = input.intent ?? 'login';
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.verifierChallenge)) {
      throw new AuthException(ErrorCode.INVALID_REQUEST, 'Verifier challenge 형식이 올바르지 않습니다.');
    }
    if ((intent === 'link' || intent === 'reauth') && !userId) {
      throw new AuthException(ErrorCode.UNAUTHORIZED, '계정 연결에는 로그인이 필요합니다.', 401);
    }
    const tx = await this.transactions.create({
      state: randomToken(32),
      nonce: randomToken(32),
      verifierChallenge: input.verifierChallenge,
      intent,
      userId,
      deviceId: input.deviceId,
    });
    return {
      transactionId: tx.id,
      authorizationUrl: this.authorizationUrl(tx),
      expiresIn: this.config.transactionTtlSec,
    };
  }

  async handleAppleCallback(body: Record<string, unknown>): Promise<{ ticket: string } | { error: string; cancelled: boolean }> {
    const state = typeof body.state === 'string' ? body.state : '';
    const tx = await this.transactions.takeByState(state);
    if (!tx) return { error: '인증 요청을 확인할 수 없습니다.', cancelled: false };
    if (typeof body.error === 'string') {
      const cancelled = body.error === 'user_cancelled' || body.error === 'access_denied';
      await this.transactions.fail(tx, cancelled ? 'cancelled' : 'failed', body.error.slice(0, 64));
      return { error: cancelled ? '로그인을 취소했습니다.' : 'Apple 로그인에 실패했습니다.', cancelled };
    }
    if (typeof body.code !== 'string' || body.code.length === 0) {
      await this.transactions.fail(tx, 'failed', 'MISSING_CODE');
      return { error: 'Apple 인증 코드가 없습니다.', cancelled: false };
    }
    try {
      const secret = this.clientSecret.create();
      const tokens = await this.oauth.exchangeAuthorizationCode({
        code: body.code,
        clientId: this.config.apple.servicesId,
        clientSecret: secret,
        redirectUri: this.config.apple.redirectUri,
      });
      const identity = await this.verifier.verify(tokens.idToken, tx.nonce);
      const ticket = await this.finishIdentity(tx, {
        sub: identity.sub,
        email: identity.email,
        isPrivateEmail: identity.isPrivateEmail,
        name: nicknameFromApple(parseJson(body.user)),
        refreshToken: tokens.refreshToken,
      });
      return { ticket };
    } catch (error) {
      const code = error instanceof AuthException ? error.code : 'APPLE_ERROR';
      await this.transactions.fail(tx, 'failed', code);
      return { error: 'Apple 인증 응답을 검증하지 못했습니다.', cancelled: false };
    }
  }

  async completeMock(input: {
    state: string;
    decision: 'approve' | 'deny';
    nickname?: string;
    email?: string;
    subject?: string;
  }): Promise<{ ticket: string } | { error: string; cancelled: boolean }> {
    this.assertMock();
    const tx = await this.transactions.takeByState(input.state);
    if (!tx) return { error: '인증 요청을 확인할 수 없습니다.', cancelled: false };
    if (input.decision === 'deny') {
      await this.transactions.fail(tx, 'cancelled', 'user_cancelled');
      return { error: '로그인을 취소했습니다.', cancelled: true };
    }
    const email = input.email?.trim() || 'test.user@privaterelay.appleid.com';
    const ticket = await this.finishIdentity(tx, {
      sub: input.subject?.trim() || 'mock.apple.user',
      email,
      isPrivateEmail: email.endsWith('@privaterelay.appleid.com'),
      name: input.nickname?.trim() || 'Test User',
      refreshToken: null,
    });
    return { ticket };
  }

  async exchange(input: { transactionId: string; ticket: string; verifier: string }, ip: string) {
    await this.rateLimit(ip, 'exchange');
    const payload = await this.transactions.consumeTicket({ ...input, intent: 'login' });
    if (!payload.userId) throw new AuthException(ErrorCode.INVALID_TICKET, '로그인 티켓에 사용자가 없습니다.');
    const social = await this.users.findByUser(payload.userId, 'apple');
    if (!social) throw new AuthException(ErrorCode.INVALID_TICKET, '연결된 사용자를 찾지 못했습니다.');
    const session = await this.sessions.issue(payload.userId);
    return { ...session, user: toPublicUser(social) };
  }

  async status(transactionId: string, verifier?: string) {
    if (!/^[A-Za-z0-9-]{16,80}$/.test(transactionId)) {
      throw new AuthException(ErrorCode.INVALID_REQUEST, '트랜잭션 식별자가 올바르지 않습니다.');
    }
    return this.transactions.status(transactionId, verifier);
  }

  async refresh(refreshToken: string, ip: string) {
    await this.rateLimit(ip, 'refresh');
    return this.sessions.refresh(refreshToken);
  }

  async logout(accessToken: string): Promise<void> {
    const claims = await this.sessions.verifyAccess(accessToken);
    await this.sessions.revokeFamily(claims.familyId);
  }

  async me(userId: string): Promise<PublicUser> {
    const social = await this.users.findByUser(userId, 'apple');
    if (!social) throw new AuthException(ErrorCode.NOT_LINKED, '연결된 Apple 계정이 없습니다.', 404);
    return toPublicUser(social);
  }

  async link(userId: string, input: { transactionId: string; ticket: string; verifier: string }) {
    const payload = await this.transactions.consumeTicket({ ...input, intent: 'link' });
    if (payload.userId !== userId) {
      throw new AuthException(ErrorCode.REAUTH_REQUIRED, '계정 연결 요청의 사용자와 일치하지 않습니다.', 403);
    }
    try {
      const social = await this.users.linkApple(userId, {
        providerUserId: payload.appleSub,
        email: payload.email,
        isPrivateEmail: payload.isPrivateEmail,
        nickname: payload.name,
        appleRefreshToken: payload.appleRefreshToken,
      });
      return { linked: true, user: toPublicUser(social) };
    } catch (error) {
      if (isConflict(error)) {
        throw new AuthException(ErrorCode.ACCOUNT_CONFLICT, '이 Apple 계정은 다른 사용자에게 연결되어 있습니다.', 409);
      }
      throw error;
    }
  }

  async unlink(userId: string): Promise<void> {
    const removed = await this.users.unlink(userId, 'apple');
    if (!removed) throw new AuthException(ErrorCode.NOT_LINKED, '연결된 Apple 계정이 없습니다.', 404);
  }

  async deleteAccount(userId: string, input: { transactionId: string; ticket: string; verifier: string }): Promise<void> {
    const payload = await this.transactions.consumeTicket({ ...input, intent: 'reauth' });
    if (payload.userId !== userId) {
      throw new AuthException(ErrorCode.REAUTH_REQUIRED, '계정 삭제 재인증이 일치하지 않습니다.', 403);
    }
    const social = await this.users.findByUser(userId, 'apple');
    if (social && social.providerUserId !== payload.appleSub) {
      throw new AuthException(ErrorCode.SUBJECT_MISMATCH, '재인증한 Apple 계정이 연결된 계정과 다릅니다.', 403);
    }
    if (social?.appleRefreshToken && !this.config.apple.mock) {
      const token = decryptString(social.appleRefreshToken, this.config.dataEncryptionKey);
      await this.oauth.revoke({
        token,
        clientId: this.config.apple.servicesId,
        clientSecret: this.clientSecret.create(),
      });
    }
    await this.sessions.revokeUser(userId);
    await this.users.deleteUser(userId);
  }

  authorizationUrl(tx: Transaction): string {
    if (this.config.apple.mock) {
      const url = new URL(`${this.config.publicBaseUrl}/auth/apple/mock`);
      url.searchParams.set('state', tx.state);
      return url.toString();
    }
    const url = new URL('https://appleid.apple.com/auth/authorize');
    url.searchParams.set('client_id', this.config.apple.servicesId);
    url.searchParams.set('redirect_uri', this.config.apple.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'form_post');
    url.searchParams.set('scope', 'name email');
    url.searchParams.set('state', tx.state);
    url.searchParams.set('nonce', tx.nonce);
    return url.toString();
  }

  private async finishIdentity(
    tx: Transaction,
    identity: { sub: string; email: string | null; isPrivateEmail: boolean; name: string | null; refreshToken: string | null },
  ): Promise<string> {
    if (tx.intent === 'reauth') {
      const linked = await this.users.findByProvider('apple', identity.sub);
      if (!linked || linked.userId !== tx.userId) {
        await this.transactions.fail(tx, 'failed', ErrorCode.SUBJECT_MISMATCH);
        throw new AuthException(ErrorCode.SUBJECT_MISMATCH, '재인증한 Apple 계정이 일치하지 않습니다.', 403);
      }
    }
    let userId = tx.userId;
    const encrypted = identity.refreshToken
      ? encryptString(identity.refreshToken, this.config.dataEncryptionKey)
      : null;
    if (tx.intent === 'login') {
      const social = await this.users.upsertApple({
        providerUserId: identity.sub,
        email: identity.email,
        isPrivateEmail: identity.isPrivateEmail,
        nickname: identity.name,
        appleRefreshToken: encrypted,
      });
      userId = social.userId;
    }
    const ticket = randomToken(32);
    await this.transactions.markReady(
      tx,
      {
        userId,
        appleSub: identity.sub,
        email: identity.email,
        isPrivateEmail: identity.isPrivateEmail,
        name: identity.name,
        appleRefreshToken: encrypted,
      },
      ticket,
    );
    return ticket;
  }

  private assertMock(): void {
    if (!this.config.apple.mock || this.config.nodeEnv === 'production') {
      throw new AuthException(ErrorCode.INVALID_REQUEST, 'Mock 로그인은 사용할 수 없습니다.', 404);
    }
  }

  private async rateLimit(ip: string, action: string): Promise<void> {
    const hits = await this.kv.incr(`apple:rl:${action}:${ip || 'unknown'}`, this.config.rateLimitWindowSec);
    if (hits > this.config.rateLimitMax) {
      throw new AuthException(ErrorCode.RATE_LIMITED, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.', 429);
    }
  }
}

export function toPublicUser(social: SocialRecord): PublicUser {
  return {
    id: social.userId,
    nickname: social.nickname,
    email: social.email,
    isPrivateEmail: social.isPrivateEmail,
    providerUserId: social.providerUserId,
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'conflict' in error);
}
