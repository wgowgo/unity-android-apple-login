import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { randomToken, sha256Hex } from '../common/crypto';
import { AuthException, ErrorCode } from '../common/errors';
import { AppConfig } from '../config/config';
import { CONFIG } from '../apple/apple-client-secret.service';
import { KvStore } from '../kv/kv';
import { KV } from '../kv/tokens';
import { SessionRecord, SessionRepo } from './records';
import { SESSION_REPO } from './tokens';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(SESSION_REPO) private readonly sessions: SessionRepo,
    @Inject(KV) private readonly kv: KvStore,
  ) {}

  async issue(userId: string): Promise<IssuedSession> {
    const refreshToken = randomToken(32);
    const session: SessionRecord = {
      id: randomUUID(),
      userId,
      familyId: randomUUID(),
      tokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + this.config.refreshTtlSec * 1000),
      revokedAt: null,
      replacedBySessionId: null,
    };
    await this.sessions.insert(session);
    return {
      accessToken: this.sign(userId, session.familyId),
      refreshToken,
      expiresIn: this.config.accessTtlSec,
    };
  }

  async refresh(refreshToken: string): Promise<IssuedSession> {
    const nextToken = randomToken(32);
    const next: SessionRecord = {
      id: randomUUID(),
      userId: '',
      familyId: '',
      tokenHash: sha256Hex(nextToken),
      expiresAt: new Date(Date.now() + this.config.refreshTtlSec * 1000),
      revokedAt: null,
      replacedBySessionId: null,
    };
    const result = await this.sessions.rotate(sha256Hex(refreshToken), next, new Date());
    if (!result.ok) {
      if (result.reason === 'reused') {
        if (result.familyId) await this.revokeFamily(result.familyId);
        throw new AuthException(ErrorCode.SESSION_REUSE, '폐기된 세션이 다시 사용되어 로그인을 종료했습니다.', 401);
      }
      throw new AuthException(ErrorCode.UNAUTHORIZED, '세션이 유효하지 않습니다.', 401);
    }
    return {
      accessToken: this.sign(result.userId, result.familyId),
      refreshToken: nextToken,
      expiresIn: this.config.accessTtlSec,
    };
  }

  async verifyAccess(token: string): Promise<{ userId: string; familyId: string }> {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
      if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.fam !== 'string') {
        throw new Error('claims');
      }
      const revoked = await this.kv.get(this.familyKey(payload.fam));
      if (revoked) throw new Error('revoked');
      return { userId: payload.sub, familyId: payload.fam };
    } catch (error) {
      if (error instanceof AuthException) throw error;
      throw new AuthException(ErrorCode.UNAUTHORIZED, '액세스 토큰이 유효하지 않습니다.', 401);
    }
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.sessions.revokeFamily(familyId, new Date());
    await this.kv.set(this.familyKey(familyId), '1', this.config.accessTtlSec);
  }

  async revokeUser(userId: string): Promise<void> {
    const families = await this.sessions.revokeUser(userId, new Date());
    await Promise.all(families.map((familyId) => this.kv.set(this.familyKey(familyId), '1', this.config.accessTtlSec)));
  }

  private sign(userId: string, familyId: string): string {
    return jwt.sign({ sub: userId, fam: familyId, typ: 'access' }, this.config.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.config.accessTtlSec,
    });
  }

  private familyKey(familyId: string): string {
    return `apple:famrev:${familyId}`;
  }
}
