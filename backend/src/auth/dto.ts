import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

export class StartDto {
  @Matches(CHALLENGE)
  verifierChallenge: string;

  @IsOptional()
  @IsIn(['login', 'link', 'reauth'])
  intent?: 'login' | 'link' | 'reauth';

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  deviceId?: string;
}

export class ExchangeDto {
  @IsUUID()
  transactionId: string;

  @Matches(TOKEN)
  ticket: string;

  @Matches(TOKEN)
  verifier: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  refreshToken: string;
}

export class MockCompleteDto {
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  state: string;

  @IsIn(['approve', 'deny'])
  decision: 'approve' | 'deny';

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  @MaxLength(64)
  nickname?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  @MaxLength(128)
  subject?: string;
}
