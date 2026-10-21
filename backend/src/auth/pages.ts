import { escapeHtml, page } from '../common/html';

export function errorPage(message: string): string {
  return page(
    '로그인 실패',
    `<h1>로그인을 마치지 못했습니다</h1><p>${escapeHtml(message)}</p><p>게임으로 돌아가 다시 시도해 주세요.</p>`,
  );
}

export function mockLoginPage(state: string): string {
  return page(
    'Apple 로그인 테스트',
    `<h1>테스트 계정으로 로그인</h1>
<p>이 화면은 APPLE_MOCK 모드에서만 표시됩니다. 실제 Apple 계정은 사용하지 않습니다.</p>
<form method="post" action="/auth/apple/mock/complete">
  <input type="hidden" name="state" value="${escapeHtml(state)}" />
  <p><label>이름<br /><input name="nickname" value="Test User" maxlength="64" /></label></p>
  <p><label>이메일<br /><input name="email" value="test.user@privaterelay.appleid.com" maxlength="320" /></label></p>
  <p><label>Apple 사용자 식별자<br /><input name="subject" value="mock.apple.user" maxlength="128" /></label></p>
  <button type="submit" name="decision" value="approve">승인</button>
  <button type="submit" name="decision" value="deny">취소</button>
</form>`,
  );
}

export function completePage(input: { ticket: string; packageName: string; publicBaseUrl: string }): string {
  const ticket = encodeURIComponent(input.ticket);
  const host = new URL(input.publicBaseUrl).host;
  const custom = `applelogin://complete?ticket=${ticket}`;
  const httpsLink = `${input.publicBaseUrl}/auth/mobile/complete?ticket=${ticket}`;
  const intent = input.packageName
    ? `intent://${host}/auth/mobile/complete?ticket=${ticket}#Intent;scheme=https;package=${input.packageName};end`
    : '';
  const intentButton = intent ? `<a href="${escapeHtml(intent)}">앱 열기</a>` : '';
  return page(
    '로그인 완료',
    `<h1>로그인이 완료되었습니다</h1>
<p>게임으로 돌아가는 중입니다. 자동으로 열리지 않으면 버튼을 눌러 주세요.</p>
<a href="${escapeHtml(custom)}">게임으로 돌아가기</a>
<a href="${escapeHtml(httpsLink)}">앱 링크로 열기</a>
${intentButton}
<script>window.location.replace(${JSON.stringify(custom)});</script>`,
  );
}
