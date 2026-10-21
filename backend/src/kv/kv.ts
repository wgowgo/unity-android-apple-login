import Redis from 'ioredis';

export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  getdel(key: string): Promise<string | null>;
  incr(key: string, ttlSec: number): Promise<number>;
}

type Entry = { value: string; expiresAt: number | null };

export class MemoryKv implements KvStore {
  private readonly map = new Map<string, Entry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async get(key: string): Promise<string | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    const expiresAt = ttlSec ? this.now() + ttlSec * 1000 : null;
    this.map.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async getdel(key: string): Promise<string | null> {
    const value = await this.get(key);
    this.map.delete(key);
    return value;
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const current = Number((await this.get(key)) ?? '0');
    const next = current + 1;
    const existing = this.map.get(key);
    const expiresAt = existing?.expiresAt ?? this.now() + ttlSec * 1000;
    this.map.set(key, { value: String(next), expiresAt });
    return next;
  }
}

export class RedisKv implements KvStore {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec) {
      await this.redis.set(key, value, 'EX', ttlSec);
      return;
    }
    await this.redis.set(key, value);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async getdel(key: string): Promise<string | null> {
    return this.redis.getdel(key);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const next = await this.redis.incr(key);
    if (next === 1) await this.redis.expire(key, ttlSec);
    return next;
  }
}

export function createKv(redisUrl: string): KvStore {
  if (!redisUrl || redisUrl.startsWith('memory')) return new MemoryKv();
  return new RedisKv(new Redis(redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true }));
}
