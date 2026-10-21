import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { AppConfig } from '../config/config';

export const CONFIG = 'APP_CONFIG';

@Injectable()
export class AppleClientSecretService {
  private cached = '';
  private cachedUntil = 0;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  create(nowSec = Math.floor(Date.now() / 1000)): string {
    if (this.cached && nowSec < this.cachedUntil) return this.cached;
    const token = jwt.sign(
      {
        iss: this.config.apple.teamId,
        sub: this.config.apple.servicesId,
        aud: 'https://appleid.apple.com',
      },
      this.config.apple.privateKeyPem,
      {
        algorithm: 'ES256',
        keyid: this.config.apple.keyId,
        expiresIn: '150d',
      },
    );
    this.cached = token;
    this.cachedUntil = nowSec + 60 * 60;
    return token;
  }
}
