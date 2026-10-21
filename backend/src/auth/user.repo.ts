import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { SocialAccountEntity, UserEntity } from '../db/entities';
import { ProfilePatch, SocialRecord, UserRepo } from './records';

@Injectable()
export class MemoryUserRepo implements UserRepo {
  private users = new Map<string, { id: string; nickname: string | null }>();
  private socials = new Map<string, SocialRecord>();
  private chain: Promise<unknown> = Promise.resolve();

  async findByProvider(provider: string, providerUserId: string): Promise<SocialRecord | null> {
    return this.socials.get(key(provider, providerUserId)) ?? null;
  }

  async upsertApple(input: ProfilePatch & { providerUserId: string }): Promise<SocialRecord> {
    return this.lock(async () => {
      const existing = await this.findByProvider('apple', input.providerUserId);
      if (existing) return this.applyProfile(existing, input);
      const userId = randomUUID();
      this.users.set(userId, { id: userId, nickname: input.nickname });
      const record = this.newSocial(userId, input);
      this.socials.set(key('apple', input.providerUserId), record);
      return record;
    });
  }

  async linkApple(userId: string, input: ProfilePatch & { providerUserId: string }): Promise<SocialRecord> {
    return this.lock(async () => {
      const existing = await this.findByProvider('apple', input.providerUserId);
      if (existing) {
        if (existing.userId !== userId) {
          const error = new Error('conflict') as Error & { conflict: boolean };
          error.conflict = true;
          throw error;
        }
        return this.applyProfile(existing, input);
      }
      if (!this.users.has(userId)) this.users.set(userId, { id: userId, nickname: input.nickname });
      const record = this.newSocial(userId, input);
      this.socials.set(key('apple', input.providerUserId), record);
      const user = this.users.get(userId);
      if (user && !user.nickname && input.nickname) user.nickname = input.nickname;
      record.nickname = this.users.get(userId)?.nickname ?? null;
      return record;
    });
  }

  async findByUser(userId: string, provider: string): Promise<SocialRecord | null> {
    for (const social of this.socials.values()) {
      if (social.userId === userId && social.provider === provider) return social;
    }
    return null;
  }

  async unlink(userId: string, provider: string): Promise<SocialRecord | null> {
    const found = await this.findByUser(userId, provider);
    if (!found) return null;
    this.socials.delete(key(found.provider, found.providerUserId));
    return found;
  }

  async deleteUser(userId: string): Promise<SocialRecord | null> {
    const social = await this.findByUser(userId, 'apple');
    this.users.delete(userId);
    if (social) this.socials.delete(key(social.provider, social.providerUserId));
    return social;
  }

  private applyProfile(existing: SocialRecord, input: ProfilePatch): SocialRecord {
    existing.email = input.email;
    existing.isPrivateEmail = input.isPrivateEmail;
    if (input.appleRefreshToken) existing.appleRefreshToken = input.appleRefreshToken;
    const user = this.users.get(existing.userId);
    if (user && !user.nickname && input.nickname) user.nickname = input.nickname;
    existing.nickname = user?.nickname ?? existing.nickname;
    return existing;
  }

  private newSocial(userId: string, input: ProfilePatch & { providerUserId: string }): SocialRecord {
    return {
      id: randomUUID(),
      userId,
      nickname: input.nickname,
      provider: 'apple',
      providerUserId: input.providerUserId,
      email: input.email,
      isPrivateEmail: input.isPrivateEmail,
      appleRefreshToken: input.appleRefreshToken,
      linkedAt: new Date(),
    };
  }

  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

@Injectable()
export class TypeormUserRepo implements UserRepo {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(SocialAccountEntity) private readonly socials: Repository<SocialAccountEntity>,
  ) {}

  async findByProvider(provider: string, providerUserId: string): Promise<SocialRecord | null> {
    const social = await this.socials.findOne({ where: { provider, providerUserId }, relations: { user: true } });
    return social ? mapSocial(social) : null;
  }

  async upsertApple(input: ProfilePatch & { providerUserId: string }): Promise<SocialRecord> {
    const existing = await this.findByProvider('apple', input.providerUserId);
    if (existing) return this.apply(existing.id, existing.userId, input);
    try {
      const user = await this.users.save(this.users.create({ nickname: input.nickname }));
      const social = await this.socials.save(
        this.socials.create({
          userId: user.id,
          provider: 'apple',
          providerUserId: input.providerUserId,
          email: input.email,
          isPrivateEmail: input.isPrivateEmail,
          appleRefreshToken: input.appleRefreshToken,
        }),
      );
      social.user = user;
      return mapSocial(social);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findByProvider('apple', input.providerUserId);
      if (!raced) throw error;
      return this.apply(raced.id, raced.userId, input);
    }
  }

  async linkApple(userId: string, input: ProfilePatch & { providerUserId: string }): Promise<SocialRecord> {
    const existing = await this.findByProvider('apple', input.providerUserId);
    if (existing) {
      if (existing.userId !== userId) {
        const error = new Error('conflict') as Error & { conflict: boolean };
        error.conflict = true;
        throw error;
      }
      return this.apply(existing.id, existing.userId, input);
    }
    const social = await this.socials.save(
      this.socials.create({
        userId,
        provider: 'apple',
        providerUserId: input.providerUserId,
        email: input.email,
        isPrivateEmail: input.isPrivateEmail,
        appleRefreshToken: input.appleRefreshToken,
      }),
    );
    await this.users
      .createQueryBuilder()
      .update()
      .set({ nickname: input.nickname ?? undefined })
      .where('id = :userId AND nickname IS NULL', { userId })
      .execute();
    const user = await this.users.findOneByOrFail({ id: userId });
    social.user = user;
    return mapSocial(social);
  }

  async findByUser(userId: string, provider: string): Promise<SocialRecord | null> {
    const social = await this.socials.findOne({ where: { userId, provider }, relations: { user: true } });
    return social ? mapSocial(social) : null;
  }

  async unlink(userId: string, provider: string): Promise<SocialRecord | null> {
    const social = await this.findByUser(userId, provider);
    if (!social) return null;
    await this.socials.delete({ id: social.id });
    return social;
  }

  async deleteUser(userId: string): Promise<SocialRecord | null> {
    const social = await this.findByUser(userId, 'apple');
    await this.users.delete({ id: userId });
    return social;
  }

  private async apply(socialId: string, userId: string, input: ProfilePatch): Promise<SocialRecord> {
    await this.socials.update(
      { id: socialId },
      {
        email: input.email,
        isPrivateEmail: input.isPrivateEmail,
        ...(input.appleRefreshToken ? { appleRefreshToken: input.appleRefreshToken } : {}),
      },
    );
    if (input.nickname) {
      await this.users
        .createQueryBuilder()
        .update()
        .set({ nickname: input.nickname })
        .where('id = :userId AND nickname IS NULL', { userId })
        .execute();
    }
    const social = await this.socials.findOneOrFail({ where: { id: socialId }, relations: { user: true } });
    return mapSocial(social);
  }
}

function mapSocial(social: SocialAccountEntity): SocialRecord {
  return {
    id: social.id,
    userId: social.userId,
    nickname: social.user?.nickname ?? null,
    provider: social.provider,
    providerUserId: social.providerUserId,
    email: social.email,
    isPrivateEmail: social.isPrivateEmail,
    appleRefreshToken: social.appleRefreshToken,
    linkedAt: social.linkedAt,
  };
}

function key(provider: string, providerUserId: string): string {
  return `${provider}:${providerUserId}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof QueryFailedError && (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === '23505';
}
