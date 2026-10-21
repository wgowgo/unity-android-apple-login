import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  publicBaseUrl: string;
  dataStore: 'memory' | 'postgres';
  databaseUrl: string;
  redisUrl: string;
  dbSynchronize: boolean;
  trustProxy: boolean;
  jwtSecret: string;
  dataEncryptionKey: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  ticketTtlSec: number;
  transactionTtlSec: number;
  rateLimitMax: number;
  rateLimitWindowSec: number;
  apple: {
    teamId: string;
    keyId: string;
    servicesId: string;
    privateKeyPem: string;
    redirectUri: string;
    mock: boolean;
  };
  android: {
    packageName: string;
    sha256Fingerprints: string[];
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const dataStore = (env.DATA_STORE ?? (nodeEnv === 'production' ? 'postgres' : 'memory')) as AppConfig['dataStore'];
  const mock = env.APPLE_MOCK === 'true';
  const publicBaseUrl = trimSlash(env.PUBLIC_BASE_URL ?? 'http://localhost:3000');
  const servicesId = env.APPLE_SERVICES_ID ?? '';
  const redirectUri = env.APPLE_REDIRECT_URI ?? `${publicBaseUrl}/auth/apple/callback`;

  if (dataStore !== 'memory' && dataStore !== 'postgres') {
    throw new Error('DATA_STORE must be memory or postgres');
  }
  if (nodeEnv === 'production') {
    if (mock) throw new Error('APPLE_MOCK cannot be enabled in production');
    if (dataStore !== 'postgres') throw new Error('production requires DATA_STORE=postgres');
    if (!env.REDIS_URL || env.REDIS_URL.startsWith('memory')) {
      throw new Error('production requires a Redis URL');
    }
  }

  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }

  let dataEncryptionKey = env.DATA_ENCRYPTION_KEY ?? '';
  if (!dataEncryptionKey) {
    if (dataStore === 'postgres' || nodeEnv === 'production') {
      throw new Error('DATA_ENCRYPTION_KEY is required when data is persisted');
    }
    dataEncryptionKey = randomBytes(32).toString('base64');
  }

  let privateKeyPem = '';
  if (!mock) {
    const required = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_SERVICES_ID'] as const;
    for (const name of required) {
      if (!env[name]) throw new Error(`${name} is required when APPLE_MOCK is not true`);
    }
    privateKeyPem = readPrivateKey(env);
    if (!privateKeyPem.includes('PRIVATE KEY')) {
      throw new Error('Apple private key must be a PEM PKCS#8 key');
    }
  }

  if (!servicesId) {
    throw new Error('APPLE_SERVICES_ID is required');
  }

  return {
    nodeEnv,
    port: Number(env.PORT ?? 3000),
    publicBaseUrl,
    dataStore,
    databaseUrl: env.DATABASE_URL ?? '',
    redisUrl: env.REDIS_URL ?? (dataStore === 'memory' ? 'memory://' : ''),
    dbSynchronize: env.DB_SYNCHRONIZE === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
    jwtSecret,
    dataEncryptionKey,
    accessTtlSec: Number(env.ACCESS_TTL_SEC ?? 900),
    refreshTtlSec: Number(env.REFRESH_TTL_SEC ?? 60 * 60 * 24 * 60),
    ticketTtlSec: Number(env.TICKET_TTL_SEC ?? 60),
    transactionTtlSec: Number(env.TRANSACTION_TTL_SEC ?? 600),
    rateLimitMax: Number(env.RATE_LIMIT_MAX ?? 30),
    rateLimitWindowSec: Number(env.RATE_LIMIT_WINDOW_SEC ?? 600),
    apple: {
      teamId: env.APPLE_TEAM_ID ?? '',
      keyId: env.APPLE_KEY_ID ?? '',
      servicesId,
      privateKeyPem,
      redirectUri,
      mock,
    },
    android: {
      packageName: env.ANDROID_PACKAGE_NAME ?? '',
      sha256Fingerprints: (env.ANDROID_SHA256_FINGERPRINTS ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    },
  };
}

function readPrivateKey(env: NodeJS.ProcessEnv): string {
  if (env.APPLE_PRIVATE_KEY) {
    return env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  }
  if (env.APPLE_PRIVATE_KEY_PATH) {
    return readFileSync(env.APPLE_PRIVATE_KEY_PATH, 'utf8');
  }
  throw new Error('APPLE_PRIVATE_KEY or APPLE_PRIVATE_KEY_PATH is required');
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
