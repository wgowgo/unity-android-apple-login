import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthException } from '../common/errors';
import { errorPage } from '../auth/pages';

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body = exception instanceof AuthException
      ? exception.getResponse()
      : {
          statusCode: status,
          code: status === 500 ? 'SERVER_ERROR' : 'INVALID_REQUEST',
          message: status === 500 ? '요청을 처리하지 못했습니다.' : '요청 형식이 올바르지 않습니다.',
        };

    if (isBrowserRoute(request.path)) {
      const message = typeof body === 'object' && body && 'message' in body ? String(body.message) : '요청을 처리하지 못했습니다.';
      response.status(status).type('html').setHeader('Cache-Control', 'no-store').send(errorPage(message));
      return;
    }
    response.status(status).json(body);
  }
}

function isBrowserRoute(path: string): boolean {
  return path.startsWith('/auth/apple/callback') || path.startsWith('/auth/apple/mock') || path.startsWith('/auth/mobile/');
}
