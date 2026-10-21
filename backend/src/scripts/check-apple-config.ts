import 'reflect-metadata';
import { loadConfig } from '../config/config';
import { AppleClientSecretService } from '../apple/apple-client-secret.service';
import jwt from 'jsonwebtoken';

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`servicesId=${config.apple.servicesId}`);
  console.log(`redirectUri=${config.apple.redirectUri}`);
  console.log(`publicBaseUrl=${config.publicBaseUrl}`);
  console.log(`packageName=${config.android.packageName || '(unset)'}`);
  if (config.apple.mock) {
    console.log('APPLE_MOCK=true. 실제 Apple 키 검사는 건너뜁니다.');
    return;
  }
  const secret = new AppleClientSecretService(config).create();
  const decoded = jwt.decode(secret, { complete: true });
  if (!decoded || typeof decoded === 'string') throw new Error('client secret을 만들지 못했습니다.');
  const payload = decoded.payload;
  if (typeof payload === 'string') throw new Error('client secret payload가 올바르지 않습니다.');
  console.log(
    JSON.stringify(
      {
        alg: decoded.header.alg,
        kid: decoded.header.kid,
        iss: payload.iss,
        sub: payload.sub,
        aud: payload.aud,
        exp: payload.exp,
      },
      null,
      2,
    ),
  );
  const response = await fetch('https://appleid.apple.com/auth/keys', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Apple JWKS 요청 실패: ${response.status}`);
  const body = (await response.json()) as { keys?: Array<{ kid?: string }> };
  console.log(`appleJwks=${body.keys?.length ?? 0}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'check failed');
  process.exit(1);
});
