export interface SocialRecord {
  id: string;
  userId: string;
  nickname: string | null;
  provider: string;
  providerUserId: string;
  email: string | null;
  isPrivateEmail: boolean;
  appleRefreshToken: string | null;
  linkedAt: Date;
}

export interface ProfilePatch {
  email: string | null;
  isPrivateEmail: boolean;
  appleRefreshToken: string | null;
  nickname: string | null;
}

export interface UserRepo {
  findByProvider(provider: string, providerUserId: string): Promise<SocialRecord | null>;
  upsertApple(input: ProfilePatch & { providerUserId: string }): Promise<SocialRecord>;
  linkApple(userId: string, input: ProfilePatch & { providerUserId: string }): Promise<SocialRecord>;
  findByUser(userId: string, provider: string): Promise<SocialRecord | null>;
  unlink(userId: string, provider: string): Promise<SocialRecord | null>;
  deleteUser(userId: string): Promise<SocialRecord | null>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
}

export interface SessionRepo {
  insert(session: SessionRecord): Promise<void>;
  rotate(
    oldHash: string,
    next: SessionRecord,
    now: Date,
  ): Promise<
    | { ok: true; userId: string; familyId: string; sessionId: string }
    | { ok: false; reason: 'missing' | 'reused' | 'expired'; familyId?: string }
  >;
  revokeFamily(familyId: string, now: Date): Promise<void>;
  revokeUser(userId: string, now: Date): Promise<string[]>;
  revokeByHash(hash: string, now: Date): Promise<void>;
}

export function nicknameFromApple(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = (raw as { name?: { firstName?: unknown; lastName?: unknown } }).name;
  if (!name) return null;
  const parts = [name.firstName, name.lastName].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  if (parts.length === 0) return null;
  return parts.join(' ').slice(0, 64);
}
