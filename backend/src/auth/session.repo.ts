import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshSessionEntity } from '../db/entities';
import { SessionRecord, SessionRepo } from './records';

@Injectable()
export class MemorySessionRepo implements SessionRepo {
  private sessions = new Map<string, SessionRecord>();

  async insert(session: SessionRecord): Promise<void> {
    this.sessions.set(session.tokenHash, { ...session });
  }

  async rotate(oldHash: string, next: SessionRecord, now: Date) {
    const current = this.sessions.get(oldHash);
    if (!current) return { ok: false as const, reason: 'missing' as const };
    if (current.revokedAt) {
      await this.revokeFamily(current.familyId, now);
      return { ok: false as const, reason: 'reused' as const, familyId: current.familyId };
    }
    if (current.expiresAt.getTime() <= now.getTime()) {
      return { ok: false as const, reason: 'expired' as const };
    }
    current.revokedAt = now;
    current.replacedBySessionId = next.id;
    next.userId = current.userId;
    next.familyId = current.familyId;
    this.sessions.set(next.tokenHash, { ...next });
    return { ok: true as const, userId: current.userId, familyId: current.familyId, sessionId: next.id };
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.familyId === familyId && !session.revokedAt) session.revokedAt = now;
    }
  }

  async revokeUser(userId: string, now: Date): Promise<string[]> {
    const families = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      families.add(session.familyId);
      if (!session.revokedAt) session.revokedAt = now;
    }
    return [...families];
  }

  async revokeByHash(hash: string, now: Date): Promise<void> {
    const session = this.sessions.get(hash);
    if (session && !session.revokedAt) session.revokedAt = now;
  }
}

@Injectable()
export class TypeormSessionRepo implements SessionRepo {
  constructor(
    @InjectRepository(RefreshSessionEntity) private readonly sessions: Repository<RefreshSessionEntity>,
  ) {}

  async insert(session: SessionRecord): Promise<void> {
    await this.sessions.save(this.sessions.create(session));
  }

  async rotate(oldHash: string, next: SessionRecord, now: Date) {
    return this.sessions.manager.transaction(async (manager) => {
      const repo = manager.getRepository(RefreshSessionEntity);
      const current = await repo.findOne({ where: { tokenHash: oldHash } });
      if (!current) return { ok: false as const, reason: 'missing' as const };
      if (current.revokedAt) {
        await repo
          .createQueryBuilder()
          .update()
          .set({ revokedAt: now })
          .where('family_id = :familyId AND revoked_at IS NULL', { familyId: current.familyId })
          .execute();
        return { ok: false as const, reason: 'reused' as const, familyId: current.familyId };
      }
      if (current.expiresAt.getTime() <= now.getTime()) {
        return { ok: false as const, reason: 'expired' as const };
      }
      current.revokedAt = now;
      current.replacedBySessionId = next.id;
      await repo.save(current);
      await repo.save(
        repo.create({
          ...next,
          userId: current.userId,
          familyId: current.familyId,
        }),
      );
      return { ok: true as const, userId: current.userId, familyId: current.familyId, sessionId: next.id };
    });
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.sessions
      .createQueryBuilder()
      .update()
      .set({ revokedAt: now })
      .where('family_id = :familyId AND revoked_at IS NULL', { familyId })
      .execute();
  }

  async revokeUser(userId: string, now: Date): Promise<string[]> {
    const rows = await this.sessions.find({ where: { userId }, select: { familyId: true } });
    await this.sessions
      .createQueryBuilder()
      .update()
      .set({ revokedAt: now })
      .where('user_id = :userId AND revoked_at IS NULL', { userId })
      .execute();
    return [...new Set(rows.map((row) => row.familyId))];
  }

  async revokeByHash(hash: string, now: Date): Promise<void> {
    await this.sessions
      .createQueryBuilder()
      .update()
      .set({ revokedAt: now })
      .where('token_hash = :hash AND revoked_at IS NULL', { hash })
      .execute();
  }
}
