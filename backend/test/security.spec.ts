import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { AppleClientSecretService } from '../src/apple/apple-client-secret.service';
import { AppleIdTokenVerifier, parsePrivateEmail } from '../src/apple/apple-id-token';
import { createVerifier, safeEqual, verifierChallenge } from '../src/common/crypto';
import { decryptString, encryptString } from '../src/common/encryption';
import { loadConfig } from '../src/config/config';
import { MemoryKv } from '../src/kv/kv';
import { AppConfig } from '../src/config/config';

describe('crypto', () => {
  it('matches the published verifier challenge vector', () => {
    const verifier = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(verifierChallenge(verifier)).toBe('ZtNPunH49FD35FWYhT5Tv8I7vRKQJ8uxMaL0_9eHjNA');
    const created = createVerifier();
    expect(verifierChallenge(created.verifier)).toBe(created.challenge);
  });

  it('compares strings without requiring equal length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('round-trips encrypted apple refresh tokens', () => {
    const key = Buffer.alloc(32, 9).toString('base64');
    const encrypted = encryptString('apple-refresh', key);
    expect(encrypted).not.toContain('apple-refresh');
    expect(decryptString(encrypted, key)).toBe('apple-refresh');
  });
});

describe('config', () => {
  it('refuses mock mode in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        APPLE_MOCK: 'true',
        JWT_SECRET: 'x'.repeat(32),
      }),
    ).toThrow(/APPLE_MOCK/);
  });
});

describe('apple client secret', () => {
  it('signs an ES256 jwt with team, services id, and key id', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const config = {
      apple: {
        teamId: 'TEAMID',
        servicesId: 'com.company.login',
        keyId: 'KEYID',
        privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      },
    } as AppConfig;
    const token = new AppleClientSecretService(config).create(1_700_000_000);
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded && typeof decoded !== 'string' && decoded.header).toMatchObject({ alg: 'ES256', kid: 'KEYID' });
    expect(decoded && typeof decoded !== 'string' && decoded.payload).toMatchObject({
      iss: 'TEAMID',
      sub: 'com.company.login',
      aud: 'https://appleid.apple.com',
    });
  });
});

describe('apple id token', () => {
  const servicesId = 'com.company.login';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const verifier = new AppleIdTokenVerifier(servicesId, { async getPublicKey() { return pem; } });

  function sign(claims: Record<string, unknown>, expiresIn: jwt.SignOptions['expiresIn'] = '5m'): string {
    return jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: servicesId,
        sub: 'apple-sub',
        nonce: 'nonce-1',
        email: 'person@privaterelay.appleid.com',
        is_private_email: true,
        ...claims,
      },
      privateKey,
      { algorithm: 'RS256', keyid: 'kid-1', expiresIn },
    );
  }

  it('accepts a token signed by the active Apple key', async () => {
    const identity = await verifier.verify(sign({}), 'nonce-1');
    expect(identity.sub).toBe('apple-sub');
    expect(identity.isPrivateEmail).toBe(true);
  });

  it('rejects a reused token with a different nonce', async () => {
    await expect(verifier.verify(sign({}), 'other-nonce')).rejects.toMatchObject({ code: 'INVALID_NONCE' });
  });

  it('rejects the wrong audience and an expired token', async () => {
    await expect(verifier.verify(sign({ aud: 'com.other.app' }), 'nonce-1')).rejects.toMatchObject({ code: 'ID_TOKEN_INVALID' });
    await expect(verifier.verify(sign({}, -180), 'nonce-1')).rejects.toMatchObject({ code: 'ID_TOKEN_INVALID' });
  });

  it('treats Apple private relay addresses as private email', () => {
    expect(parsePrivateEmail(undefined, 'a@privaterelay.appleid.com')).toBe(true);
    expect(parsePrivateEmail('false', 'person@example.com')).toBe(false);
  });
});

describe('memory kv', () => {
  it('expires values and deletes them on read', async () => {
    let now = 1_000;
    const kv = new MemoryKv(() => now);
    await kv.set('ticket', 'value', 60);
    expect(await kv.get('ticket')).toBe('value');
    now += 60_001;
    expect(await kv.get('ticket')).toBeNull();
    expect(await kv.getdel('ticket')).toBeNull();
  });
});
