import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function verifierChallenge(verifier: string): string {
  return sha256Base64Url(verifier);
}

/** 길이가 달라도 비교 시간을 맞추기 위해 다이제스트를 비교한다. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export function createVerifier(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  return { verifier, challenge: verifierChallenge(verifier) };
}
