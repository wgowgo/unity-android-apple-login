import 'reflect-metadata';
import { json, urlencoded } from 'express';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CONFIG } from './apple/apple-client-secret.service';
import { AppModule } from './app.module';
import { AuthException, ErrorCode } from './common/errors';
import { AuthExceptionFilter } from './common/exception.filter';
import { AppConfig } from './config/config';

export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(CONFIG);
  const server = app.getHttpAdapter().getInstance() as {
    set: (name: string, value: unknown) => void;
    use: (handler: unknown) => void;
  };
  if (config.trustProxy) server.set('trust proxy', 1);
  server.use((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(json({ limit: '16kb' }));
  app.use(urlencoded({ extended: false, limit: '16kb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new AuthException(
          ErrorCode.INVALID_REQUEST,
          errors
            .map((error) => Object.values(error.constraints ?? {}).join(', '))
            .filter(Boolean)
            .join('; ') || '요청 형식이 올바르지 않습니다.',
        ),
    }),
  );
  app.useGlobalFilters(new AuthExceptionFilter());
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  const config = app.get<AppConfig>(CONFIG);
  await app.listen(config.port);
  console.log(`auth server listening on ${config.publicBaseUrl}`);
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'failed to start';
    console.error(message);
    process.exit(1);
  });
}
