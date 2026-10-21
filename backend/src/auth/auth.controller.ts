import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CONFIG } from '../apple/apple-client-secret.service';
import { AppConfig } from '../config/config';
import { AuthException, ErrorCode } from '../common/errors';
import { AuthService } from './auth.service';
import { ExchangeDto, MockCompleteDto, RefreshDto, StartDto } from './dto';
import { completePage, errorPage, mockLoginPage } from './pages';
import { SessionService } from './session.service';

interface AuthedRequest extends Request {
  auth?: { userId: string; familyId: string };
  accessToken?: string;
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(request);
    if (!token) throw new AuthException(ErrorCode.UNAUTHORIZED, '로그인이 필요합니다.', 401);
    request.auth = await this.sessions.verifyAccess(token);
    request.accessToken = token;
    return true;
  }
}

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Post('auth/apple/start')
  async start(@Body() body: StartDto, @Req() request: Request) {
    const userId = await this.optionalUser(request);
    return this.auth.start(body, userId, clientIp(request));
  }

  @Post('auth/apple/callback')
  async callback(@Body() body: Record<string, unknown>, @Res() response: Response) {
    const result = await this.auth.handleAppleCallback(body ?? {});
    this.sendBrowserResult(response, result);
  }

  @Get('auth/apple/mock')
  mockPage(@Query('state') state: string, @Res() response: Response) {
    this.ensureMock();
    if (!state) {
      response.status(400).type('html').send(errorPage('인증 요청을 확인할 수 없습니다.'));
      return;
    }
    response.type('html').setHeader('Cache-Control', 'no-store').send(mockLoginPage(state));
  }

  @Post('auth/apple/mock/complete')
  async mockComplete(@Body() body: MockCompleteDto, @Res() response: Response) {
    this.ensureMock();
    try {
      const result = await this.auth.completeMock(body);
      this.sendBrowserResult(response, result);
    } catch (error) {
      const status = error instanceof AuthException ? error.getStatus() : 400;
      const message = error instanceof AuthException ? error.message : '인증에 실패했습니다.';
      response.status(status).type('html').setHeader('Cache-Control', 'no-store').send(errorPage(message));
    }
  }

  @Post('auth/apple/exchange')
  exchange(@Body() body: ExchangeDto, @Req() request: Request) {
    return this.auth.exchange(body, clientIp(request));
  }

  @Get('auth/apple/status')
  status(@Query('transactionId') transactionId: string, @Headers('x-login-verifier') verifier?: string | string[]) {
    const header = Array.isArray(verifier) ? verifier[0] : verifier;
    return this.auth.status(transactionId, header || undefined);
  }

  @Post('auth/refresh')
  refresh(@Body() body: RefreshDto, @Req() request: Request) {
    return this.auth.refresh(body.refreshToken, clientIp(request));
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(AccessGuard)
  async logout(@Req() request: AuthedRequest) {
    await this.auth.logout(request.accessToken ?? '');
  }

  @Get('auth/me')
  @UseGuards(AccessGuard)
  me(@Req() request: AuthedRequest) {
    return this.auth.me(request.auth!.userId);
  }

  @Post('auth/apple/link')
  @UseGuards(AccessGuard)
  link(@Body() body: ExchangeDto, @Req() request: AuthedRequest) {
    return this.auth.link(request.auth!.userId, body);
  }

  @Delete('auth/apple/link')
  @HttpCode(204)
  @UseGuards(AccessGuard)
  async unlink(@Req() request: AuthedRequest) {
    await this.auth.unlink(request.auth!.userId);
  }

  @Post('auth/account/delete')
  @HttpCode(204)
  @UseGuards(AccessGuard)
  async deleteAccount(@Body() body: ExchangeDto, @Req() request: AuthedRequest) {
    await this.auth.deleteAccount(request.auth!.userId, body);
  }

  @Get('.well-known/assetlinks.json')
  assetLinks(@Res() response: Response) {
    const fingerprints = this.config.android.sha256Fingerprints;
    const packageName = this.config.android.packageName;
    const body = packageName && fingerprints.length > 0
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: packageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [];
    response.type('application/json').send(body);
  }

  @Get('auth/mobile/complete')
  complete(@Query('ticket') ticket: string, @Res() response: Response) {
    if (!ticket || !/^[A-Za-z0-9_-]{20,200}$/.test(ticket)) {
      response.status(400).type('html').send(errorPage('로그인 티켓이 올바르지 않습니다.'));
      return;
    }
    response
      .setHeader('Cache-Control', 'no-store')
      .setHeader('Referrer-Policy', 'no-referrer')
      .type('html')
      .send(
        completePage({
          ticket,
          packageName: this.config.android.packageName,
          publicBaseUrl: this.config.publicBaseUrl,
        }),
      );
  }

  private sendBrowserResult(
    response: Response,
    result: { ticket: string } | { error: string; cancelled: boolean },
  ) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if ('ticket' in result) {
      const location = `${this.config.publicBaseUrl}/auth/mobile/complete?ticket=${encodeURIComponent(result.ticket)}`;
      response.redirect(303, location);
      return;
    }
    response.status(400).type('html').send(errorPage(result.error));
  }

  private ensureMock() {
    if (!this.config.apple.mock || this.config.nodeEnv === 'production') {
      throw new AuthException(ErrorCode.INVALID_REQUEST, 'Mock 로그인은 사용할 수 없습니다.', 404);
    }
  }

  private async optionalUser(request: Request): Promise<string | undefined> {
    const token = bearer(request);
    if (!token) return undefined;
    const claims = await this.sessions.verifyAccess(token);
    return claims.userId;
  }
}

function bearer(request: Request): string {
  const header = request.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}
