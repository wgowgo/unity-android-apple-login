import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadEnv } from 'dotenv';
import { AppleClientSecretService, CONFIG } from './apple/apple-client-secret.service';
import { AppleIdTokenVerifier, AppleJwksService } from './apple/apple-id-token';
import { AppleOAuthClient } from './apple/apple-oauth.client';
import { AccessGuard, AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { MemorySessionRepo, TypeormSessionRepo } from './auth/session.repo';
import { SessionService } from './auth/session.service';
import { SESSION_REPO, USER_REPO } from './auth/tokens';
import { TransactionStore } from './auth/transaction.store';
import { MemoryUserRepo, TypeormUserRepo } from './auth/user.repo';
import { loadConfig } from './config/config';
import { RefreshSessionEntity, SocialAccountEntity, UserEntity } from './db/entities';
import { createKv, KvStore } from './kv/kv';
import { KV } from './kv/tokens';

loadEnv();
const config = loadConfig();

const databaseImports =
  config.dataStore === 'postgres'
    ? [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: config.databaseUrl,
          entities: [UserEntity, SocialAccountEntity, RefreshSessionEntity],
          synchronize: config.dbSynchronize,
        }),
        TypeOrmModule.forFeature([UserEntity, SocialAccountEntity, RefreshSessionEntity]),
      ]
    : [];

@Module({
  imports: databaseImports,
  controllers: [AuthController],
  providers: [
    { provide: CONFIG, useValue: config },
    { provide: KV, useFactory: () => createKv(config.redisUrl) },
    {
      provide: USER_REPO,
      useClass: config.dataStore === 'memory' ? MemoryUserRepo : TypeormUserRepo,
    },
    {
      provide: SESSION_REPO,
      useClass: config.dataStore === 'memory' ? MemorySessionRepo : TypeormSessionRepo,
    },
    {
      provide: TransactionStore,
      inject: [KV],
      useFactory: (kv: KvStore) => new TransactionStore(kv, config.transactionTtlSec, config.ticketTtlSec),
    },
    AppleJwksService,
    {
      provide: AppleIdTokenVerifier,
      inject: [AppleJwksService],
      useFactory: (keys: AppleJwksService) => new AppleIdTokenVerifier(config.apple.servicesId, keys),
    },
    AppleClientSecretService,
    AppleOAuthClient,
    SessionService,
    AuthService,
    AccessGuard,
  ],
})
export class AppModule {}
