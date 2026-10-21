import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { createVerifier } from '../src/common/crypto';

describe('apple auth http flow', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in, restores the user, rotates refresh tokens, and rejects reuse', async () => {
    const first = await login({ nickname: '처음', subject: 'apple-user-1' });
    expect(first.user.nickname).toBe('처음');
    expect(first.user.isPrivateEmail).toBe(true);
    expect(first.user.providerUserId).toBe('apple-user-1');

    const again = await login({ nickname: '나중', subject: 'apple-user-1', email: 'other@privaterelay.appleid.com' });
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.nickname).toBe('처음');
    expect(again.user.email).toBe('other@privaterelay.appleid.com');

    const me = await request(app.getHttpServer()).get('/auth/me').set('authorization', `Bearer ${again.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(first.user.id);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: again.refreshToken });
    expect(refreshed.status).toBe(201);
    expect(refreshed.body.refreshToken).not.toBe(again.refreshToken);

    const reused = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: again.refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('SESSION_REUSE');

    const rotatedAgain = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken });
    expect(rotatedAgain.status).toBe(401);

    const afterReuse = await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(afterReuse.status).toBe(401);
  });

  it('keeps the ticket when the verifier does not match, then exchanges it once', async () => {
    const { verifier, challenge } = createVerifier();
    const started = await request(app.getHttpServer())
      .post('/auth/apple/start')
      .send({ verifierChallenge: challenge, intent: 'login', deviceId: 'device-a' });
    const state = new URL(started.body.authorizationUrl).searchParams.get('state');
    const approved = await request(app.getHttpServer())
      .post('/auth/apple/mock/complete')
      .type('form')
      .send({ state, decision: 'approve', subject: 'apple-user-verifier' });
    const ticket = new URL(approved.headers.location).searchParams.get('ticket');

    const wrong = await request(app.getHttpServer()).post('/auth/apple/exchange').send({
      transactionId: started.body.transactionId,
      ticket,
      verifier: 'b'.repeat(43),
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('VERIFIER_MISMATCH');

    const recovered = await request(app.getHttpServer())
      .get('/auth/apple/status')
      .query({ transactionId: started.body.transactionId })
      .set('x-login-verifier', verifier);
    expect(recovered.body.ticket).toBe(ticket);

    const hidden = await request(app.getHttpServer())
      .get('/auth/apple/status')
      .query({ transactionId: started.body.transactionId });
    expect(hidden.body.ticket).toBeUndefined();

    const exchanged = await request(app.getHttpServer()).post('/auth/apple/exchange').send({
      transactionId: started.body.transactionId,
      ticket,
      verifier,
    });
    expect(exchanged.status).toBe(201);

    const second = await request(app.getHttpServer()).post('/auth/apple/exchange').send({
      transactionId: started.body.transactionId,
      ticket,
      verifier,
    });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('TICKET_EXPIRED');
  });

  it('rejects a replayed apple state and a superseded device login', async () => {
    const first = createVerifier();
    const started = await request(app.getHttpServer())
      .post('/auth/apple/start')
      .send({ verifierChallenge: first.challenge, deviceId: 'device-b' });
    const state = new URL(started.body.authorizationUrl).searchParams.get('state');
    await request(app.getHttpServer())
      .post('/auth/apple/mock/complete')
      .type('form')
      .send({ state, decision: 'approve', subject: 'replay-user' });
    const replay = await request(app.getHttpServer())
      .post('/auth/apple/mock/complete')
      .type('form')
      .send({ state, decision: 'approve', subject: 'replay-user' });
    expect(replay.status).toBe(400);
    expect(replay.text).toContain('인증 요청을 확인할 수 없습니다');

    const older = createVerifier();
    const olderStart = await request(app.getHttpServer())
      .post('/auth/apple/start')
      .send({ verifierChallenge: older.challenge, deviceId: 'device-c' });
    const newer = createVerifier();
    const newerStart = await request(app.getHttpServer())
      .post('/auth/apple/start')
      .send({ verifierChallenge: newer.challenge, deviceId: 'device-c' });
    const oldState = new URL(olderStart.body.authorizationUrl).searchParams.get('state');
    const superseded = await request(app.getHttpServer())
      .post('/auth/apple/mock/complete')
      .type('form')
      .send({ state: oldState, decision: 'approve', subject: 'device-user' });
    expect(superseded.status).toBe(400);

    const newState = new URL(newerStart.body.authorizationUrl).searchParams.get('state');
    const approved = await request(app.getHttpServer())
      .post('/auth/apple/mock/complete')
      .type('form')
      .send({ state: newState, decision: 'approve', subject: 'device-user' });
    expect(approved.status).toBe(303);
  });

  it('links an apple account only to the authenticated user and can unlink it', async () => {
    const owner = await login({ subject: 'link-owner', nickname: '소유자' });
    const other = await login({ subject: 'link-other', nickname: '다른사람' });

    const conflict = await finishIntent(owner.accessToken, 'link', 'link-other');
    const conflictResponse = await request(app.getHttpServer())
      .post('/auth/apple/link')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send(conflict);
    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body.code).toBe('ACCOUNT_CONFLICT');

    const same = await finishIntent(owner.accessToken, 'link', 'link-owner');
    const linked = await request(app.getHttpServer())
      .post('/auth/apple/link')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send(same);
    expect(linked.status).toBe(201);
    expect(linked.body.user.id).toBe(owner.user.id);

    const removed = await request(app.getHttpServer())
      .delete('/auth/apple/link')
      .set('authorization', `Bearer ${owner.accessToken}`);
    expect(removed.status).toBe(204);
    const missing = await request(app.getHttpServer()).get('/auth/me').set('authorization', `Bearer ${owner.accessToken}`);
    expect(missing.status).toBe(404);

    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('authorization', `Bearer ${other.accessToken}`);
    expect(logout.status).toBe(204);
    const afterLogout = await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${other.accessToken}`);
    expect(afterLogout.status).toBe(401);
  });

  it('deletes the account only after a fresh apple reauthentication', async () => {
    const user = await login({ subject: 'delete-me', nickname: '삭제' });
    const reauth = await finishIntent(user.accessToken, 'reauth', 'delete-me');
    const deleted = await request(app.getHttpServer())
      .post('/auth/account/delete')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send(reauth);
    expect(deleted.status).toBe(204);
    const me = await request(app.getHttpServer()).get('/auth/me').set('authorization', `Bearer ${user.accessToken}`);
    expect(me.status).toBe(401);
    const refreshed = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(refreshed.status).toBe(401);
  });

  it('serves an empty asset link list until a certificate fingerprint is configured', async () => {
    const response = await request(app.getHttpServer()).get('/.well-known/assetlinks.json');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  async function login(input: { nickname: string; subject: string; email?: string }) {
    const pending = await finishIntent(undefined, 'login', input.subject, input.nickname, input.email);
    const response = await request(app.getHttpServer()).post('/auth/apple/exchange').send(pending);
    expect(response.status).toBe(201);
    return response.body as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; nickname: string; email: string; isPrivateEmail: boolean; providerUserId: string };
    };
  }

  async function finishIntent(
    accessToken: string | undefined,
    intent: 'login' | 'link' | 'reauth',
    subject: string,
    nickname = 'Test User',
    email = 'test.user@privaterelay.appleid.com',
  ) {
    const { verifier, challenge } = createVerifier();
    const start = request(app.getHttpServer()).post('/auth/apple/start').send({ verifierChallenge: challenge, intent });
    if (accessToken) start.set('authorization', `Bearer ${accessToken}`);
    const started = await start;
    expect(started.status).toBe(201);
    const state = new URL(started.body.authorizationUrl).searchParams.get('state');
    const approved = await request(app.getHttpServer())
      .post('/auth/apple/mock/complete')
      .type('form')
      .send({ state, decision: 'approve', nickname, email, subject });
    expect(approved.status).toBe(303);
    return {
      transactionId: started.body.transactionId as string,
      ticket: new URL(approved.headers.location as string).searchParams.get('ticket'),
      verifier,
    };
  }
});
