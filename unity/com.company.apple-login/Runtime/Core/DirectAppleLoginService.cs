using System;
using System.Threading;
using System.Threading.Tasks;

namespace AppleLoginSDK
{
    public sealed class DirectAppleLoginService : IAppleLoginService
    {
        const string AuthorizeUrl = "https://appleid.apple.com/auth/authorize";
        readonly AppleLoginConfig config;
        readonly SessionManager session;
        readonly IAuthBrowser browser;
        bool busy;

        public DirectAppleLoginService(AppleLoginConfig config, SessionManager session, IAuthBrowser browser)
        {
            this.config = config;
            this.session = session;
            this.browser = browser;
        }

        public bool IsLoggedIn { get { return session.HasRefreshToken && session.CurrentUser != null; } }
        public AppleUser CurrentUser { get { return session.CurrentUser; } }
        public event Action<AppleLoginResult> OnLoginSuccess;
        public event Action<AppleLoginError> OnLoginFailed;
        public event Action OnLogout;

        public async Task<AppleLoginResult> LoginAsync(CancellationToken cancellationToken = default)
        {
            if (busy) throw new AppleLoginException(AppleLoginErrorCode.AlreadyInProgress, "로그인이 이미 진행 중입니다.");
            busy = true;
            try
            {
                RequireConfig();
                string state = LoginTransaction.Create().Verifier;
                string nonce = LoginTransaction.Create().Verifier;
                browser.Open(BuildAuthorizeUrl(state, nonce));
                NativeAuthResult nativeAuthResult = await WaitForTokenAsync(state, cancellationToken);
                AppleIdTokenPayload identityTokenPayload = await AppleIdTokenVerifier.VerifyAsync(nativeAuthResult.idToken, config.servicesId, nonce, cancellationToken);
                int expiresInSeconds = (int)Math.Max(1, identityTokenPayload.exp - DateTimeOffset.UtcNow.ToUnixTimeSeconds());
                AppleUser appleUser = new AppleUser { id = identityTokenPayload.sub, providerUserId = identityTokenPayload.sub };
                session.Save(nativeAuthResult.idToken, "direct", expiresInSeconds, appleUser);
                AppleLoginResult loginResult = new AppleLoginResult
                {
                    User = appleUser,
                    AccessToken = nativeAuthResult.idToken,
                    RefreshToken = "direct",
                    ExpiresIn = expiresInSeconds
                };
                if (OnLoginSuccess != null) OnLoginSuccess(loginResult);
                return loginResult;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (AppleLoginException exception)
            {
                if (OnLoginFailed != null) OnLoginFailed(new AppleLoginError { Code = exception.ErrorCode, Message = exception.Message });
                throw;
            }
            finally
            {
                busy = false;
            }
        }

        public Task<bool> RestoreSessionAsync()
        {
            if (!session.HasRefreshToken || session.CurrentUser == null || !session.AccessValid)
            {
                if (session.HasRefreshToken && !session.AccessValid) session.Clear();
                return Task.FromResult(false);
            }
            return Task.FromResult(true);
        }

        public Task<AppleLoginResult> RefreshSessionAsync()
        {
            if (!IsLoggedIn || !session.AccessValid)
                throw new AppleLoginException(AppleLoginErrorCode.SessionExpired, "Apple ID Token이 만료되었습니다.");
            return Task.FromResult(new AppleLoginResult
            {
                User = session.CurrentUser,
                AccessToken = session.AccessToken,
                RefreshToken = session.RefreshToken
            });
        }

        public Task LogoutAsync()
        {
            session.Clear();
            if (OnLogout != null) OnLogout();
            return Task.CompletedTask;
        }

        public Task<AppleLoginResult> LinkAsync(CancellationToken cancellationToken = default)
        {
            throw new AppleLoginException(AppleLoginErrorCode.Configuration, "직접 Apple 로그인은 계정 연결을 지원하지 않습니다.");
        }

        public Task UnlinkAsync()
        {
            throw new AppleLoginException(AppleLoginErrorCode.Configuration, "직접 Apple 로그인은 계정 연결 해제를 지원하지 않습니다.");
        }

        public Task DeleteAccountAsync(CancellationToken cancellationToken = default)
        {
            throw new AppleLoginException(AppleLoginErrorCode.Configuration, "직접 Apple 로그인은 계정 삭제를 지원하지 않습니다.");
        }

        async Task<NativeAuthResult> WaitForTokenAsync(string state, CancellationToken cancellationToken)
        {
            DateTime deadlineUtc = DateTime.UtcNow.AddSeconds(AppleLoginConstants.LoginTimeoutSeconds);
            while (DateTime.UtcNow < deadlineUtc)
            {
                cancellationToken.ThrowIfCancellationRequested();
                NativeAuthResult nativeAuthResult;
                if (browser.TryConsume(out nativeAuthResult))
                {
                    if (nativeAuthResult.status == "cancelled") throw new OperationCanceledException();
                    if (nativeAuthResult.status == "error")
                        throw new AppleLoginException(AppleLoginErrorCode.ProviderError, string.IsNullOrEmpty(nativeAuthResult.message) ? "Apple 로그인에 실패했습니다." : nativeAuthResult.message);
                    if (!string.IsNullOrEmpty(nativeAuthResult.idToken))
                    {
                        if (nativeAuthResult.state != state)
                            throw new AppleLoginException(AppleLoginErrorCode.InvalidState, "로그인 요청의 state가 일치하지 않습니다.");
                        return nativeAuthResult;
                    }
                }
                await Task.Delay(AppleLoginConstants.StatusPollMilliseconds, cancellationToken);
            }
            throw new AppleLoginException(AppleLoginErrorCode.Timeout, "로그인 시간이 초과되었습니다.");
        }

        string BuildAuthorizeUrl(string state, string nonce)
        {
            return AuthorizeUrl
                + "?client_id=" + Uri.EscapeDataString(config.servicesId)
                + "&redirect_uri=" + Uri.EscapeDataString(config.redirectUri)
                + "&response_type=id_token"
                + "&response_mode=fragment"
                + "&state=" + Uri.EscapeDataString(state)
                + "&nonce=" + Uri.EscapeDataString(nonce);
        }

        void RequireConfig()
        {
            Uri redirect;
            if (config == null || string.IsNullOrWhiteSpace(config.servicesId))
                throw new AppleLoginException(AppleLoginErrorCode.Configuration, "Services ID가 없습니다.");
            if (!Uri.TryCreate(config.redirectUri, UriKind.Absolute, out redirect) || redirect.Scheme != "https")
                throw new AppleLoginException(AppleLoginErrorCode.Configuration, "Redirect URI는 HTTPS 주소여야 합니다.");
        }
    }
}
