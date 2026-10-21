import { createPublicKey, JsonWebKey } from 'crypto';
import { Injectable } from '@nestjs/common';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { AuthException, ErrorCode } from '../common/errors';

export interface AppleIdentity {
  sub: string;
  email: string | null;
  isPrivateEmail: boolean;
  nonce: string;
}

export interface KeyProvider {
  getPublicKey(kid: string): Promise<string>;
}

export class AppleIdTokenVerifier {
  constructor(
    private readonly servicesId: string,
    private readonly keys: KeyProvider,
  ) {}

  async verify(idToken: string, expectedNonce: string): Promise<AppleIdentity> {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
      throw new AuthException(ErrorCode.ID_TOKEN_INVALID, 'ID Token 형식이 올바르지 않습니다.');
    }
    if (decoded.header.alg !== 'RS256') {
      throw new AuthException(ErrorCode.ID_TOKEN_INVALID, 'ID Token 서명 알고리즘이 올바르지 않습니다.');
    }

    let pem: string;
    try {
      pem = await this.keys.getPublicKey(decoded.header.kid);
    } catch {
      throw new AuthException(ErrorCode.ID_TOKEN_INVALID, 'Apple 공개 키를 확인하지 못했습니다.');
    }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(idToken, pem, {
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        audience: this.servicesId,
        clockTolerance: 60,
      }) as JwtPayload;
    } catch {
      throw new AuthException(ErrorCode.ID_TOKEN_INVALID, 'ID Token 검증에 실패했습니다.');
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new AuthException(ErrorCode.ID_TOKEN_INVALID, 'Apple 사용자 식별자가 없습니다.');
    }
    if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce) {
      throw new AuthException(ErrorCode.INVALID_NONCE, 'Nonce가 로그인 요청과 일치하지 않습니다.');
    }

    const email = typeof payload.email === 'string' ? payload.email : null;
    return {
      sub: payload.sub,
      email,
      isPrivateEmail: parsePrivateEmail(payload.is_private_email, email),
      nonce: payload.nonce,
    };
  }
}

export function parsePrivateEmail(claim: unknown, email: string | null): boolean {
  if (claim === true || claim === 'true') return true;
  if (claim === false || claim === 'false') return false;
  return Boolean(email && email.endsWith('@privaterelay.appleid.com'));
}

@Injectable()
export class AppleJwksService implements KeyProvider {
  private keys = new Map<string, string>();
  private fetchedAt = 0;
  private readonly fetchKeys: () => Promise<JsonWebKey[]> = fetchAppleKeys;

  async getPublicKey(kid: string): Promise<string> {
    if (!this.keys.has(kid) || Date.now() - this.fetchedAt > 60 * 60 * 1000) {
      await this.refresh();
    }
    const pem = this.keys.get(kid);
    if (!pem) {
      await this.refresh();
    }
    const refreshed = this.keys.get(kid);
    if (!refreshed) {
      throw new Error('unknown kid');
    }
    return refreshed;
  }

  private async refresh(): Promise<void> {
    const keys = await this.fetchKeys();
    const next = new Map<string, string>();
    for (const jwk of keys) {
      const kid = typeof jwk.kid === 'string' ? jwk.kid : '';
      if (!kid) continue;
      const key = createPublicKey({ key: jwk as never, format: 'jwk' });
      next.set(kid, key.export({ type: 'spki', format: 'pem' }).toString());
    }
    this.keys = next;
    this.fetchedAt = Date.now();
  }
}

async function fetchAppleKeys(): Promise<JsonWebKey[]> {
  const response = await fetch('https://appleid.apple.com/auth/keys', {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('jwks http');
  const body = (await response.json()) as { keys?: JsonWebKey[] };
  return body.keys ?? [];
}
