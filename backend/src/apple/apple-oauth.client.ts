import { Injectable } from '@nestjs/common';
import { AuthException, ErrorCode } from '../common/errors';

export interface AppleTokenSet {
  idToken: string;
  refreshToken: string | null;
  accessToken: string | null;
}

@Injectable()
export class AppleOAuthClient {
  private readonly endpoint = 'https://appleid.apple.com/auth/token';

  async exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<AppleTokenSet> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    });
    return this.post(body);
  }

  async revoke(input: { token: string; clientId: string; clientSecret: string }): Promise<void> {
    const body = new URLSearchParams({
      token: input.token,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      token_type_hint: 'refresh_token',
    });
    const response = await fetch('https://appleid.apple.com/auth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new AuthException(ErrorCode.APPLE_ERROR, 'Apple 인증 권한을 철회하지 못했습니다.', 502);
    }
  }

  private async post(body: URLSearchParams): Promise<AppleTokenSet> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new AuthException(ErrorCode.TOKEN_EXCHANGE_FAILED, 'Apple 토큰 서버에 연결하지 못했습니다.', 502);
    }
    if (!response.ok) {
      throw new AuthException(ErrorCode.TOKEN_EXCHANGE_FAILED, 'Apple 인증 코드를 교환하지 못했습니다.', 502);
    }
    const json = (await response.json()) as {
      id_token?: string;
      refresh_token?: string;
      access_token?: string;
    };
    if (!json.id_token) {
      throw new AuthException(ErrorCode.TOKEN_EXCHANGE_FAILED, 'Apple ID Token이 없습니다.', 502);
    }
    return {
      idToken: json.id_token,
      refreshToken: json.refresh_token ?? null,
      accessToken: json.access_token ?? null,
    };
  }
}
