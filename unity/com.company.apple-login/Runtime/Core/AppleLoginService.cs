using System;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace AppleLoginSDK
{
    public sealed class AppleLoginService : IAppleLoginService
    {
        readonly AppleLoginConfig config;
        readonly AppleAuthApiClient authApiClient;
        readonly SessionManager session;
        readonly IAuthBrowser browser;
        bool busy;

        public AppleLoginService(AppleLoginConfig config, AppleAuthApiClient authApiClient, SessionManager session, IAuthBrowser browser)
        {
            this.config = config;
            this.authApiClient = authApiClient;
            this.session = session;
            this.browser = browser;
        }

        public bool IsLoggedIn { get { return session.HasRefreshToken; } }
        public AppleUser CurrentUser { get { return session.CurrentUser; } }
        public event Action<AppleLoginResult> OnLoginSuccess;
        public event Action<AppleLoginError> OnLoginFailed;
        public event Action OnLogout;

        public Task<AppleLoginResult> LoginAsync(CancellationToken cancellationToken = default)
        {
            return AuthenticateAsync("login", null, cancellationToken);
        }

        public async Task<AppleLoginResult> LinkAsync(CancellationToken cancellationToken = default)
        {
            RequireSession();
            AppleLoginResult linkResult = await AuthenticateAsync("link", session.AccessToken, cancellationToken);
            return linkResult;
        }

        public async Task UnlinkAsync()
        {
            RequireSession();
            await authApiClient.UnlinkAsync(session.AccessToken, CancellationToken.None);
            session.UpdateUser(null);
        }

        public async Task DeleteAccountAsync(CancellationToken cancellationToken = default)
        {
            RequireSession();
            if (busy) throw new AppleLoginException(AppleLoginErrorCode.AlreadyInProgress, "로그인이 이미 진행 중입니다.");
            busy = true;
            try
            {
                LoginTransaction loginTransaction = LoginTransaction.Create();
                StartResponse startedAuthentication = await authApiClient.StartAsync(loginTransaction.Challenge, "reauth", DeviceId(), session.AccessToken, cancellationToken);
                browser.Open(startedAuthentication.authorizationUrl);
                string loginTicket = await WaitForTicketAsync(startedAuthentication.transactionId, loginTransaction.Verifier, cancellationToken);
                await authApiClient.DeleteAccountAsync(startedAuthentication.transactionId, loginTicket, loginTransaction.Verifier, session.AccessToken, cancellationToken);
                session.Clear();
                OnLogout?.Invoke();
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (AppleLoginException exception)
            {
                PublishFailure(exception);
                throw;
            }
            finally
            {
                busy = false;
            }
        }

        public async Task<bool> RestoreSessionAsync()
        {
            if (!session.HasRefreshToken) return false;
            try
            {
                if (!session.AccessValid)
                {
                    RefreshResponse refreshedSession = await authApiClient.RefreshAsync(session.RefreshToken, CancellationToken.None);
                    session.UpdateAccess(refreshedSession.accessToken, refreshedSession.refreshToken, refreshedSession.expiresIn);
                }
                AppleUser currentUser = await authApiClient.MeAsync(session.AccessToken, CancellationToken.None);
                session.UpdateUser(currentUser);
                return true;
            }
            catch (AppleLoginException exception) when (exception.ErrorCode == AppleLoginErrorCode.NotAuthenticated)
            {
                session.UpdateUser(null);
                return session.HasRefreshToken;
            }
            catch (AppleLoginException exception) when (exception.ErrorCode == AppleLoginErrorCode.SessionExpired)
            {
                session.Clear();
                return false;
            }
        }

        public async Task<AppleLoginResult> RefreshSessionAsync()
        {
            RequireSession();
            RefreshResponse refreshedSession = await authApiClient.RefreshAsync(session.RefreshToken, CancellationToken.None);
            session.UpdateAccess(refreshedSession.accessToken, refreshedSession.refreshToken, refreshedSession.expiresIn);
            return new AppleLoginResult
            {
                User = session.CurrentUser,
                AccessToken = refreshedSession.accessToken,
                RefreshToken = refreshedSession.refreshToken,
                ExpiresIn = refreshedSession.expiresIn
            };
        }

        public async Task LogoutAsync()
        {
            try
            {
                if (!string.IsNullOrEmpty(session.AccessToken))
                {
                    await authApiClient.LogoutAsync(session.AccessToken, CancellationToken.None);
                }
            }
            catch (AppleLoginException)
            {
            }
            session.Clear();
            OnLogout?.Invoke();
        }

        async Task<AppleLoginResult> AuthenticateAsync(string intent, string accessToken, CancellationToken cancellationToken)
        {
            if (busy) throw new AppleLoginException(AppleLoginErrorCode.AlreadyInProgress, "로그인이 이미 진행 중입니다.");
            busy = true;
            try
            {
                LoginTransaction loginTransaction = LoginTransaction.Create();
                StartResponse startedAuthentication = await authApiClient.StartAsync(loginTransaction.Challenge, intent, DeviceId(), accessToken, cancellationToken);
                browser.Open(startedAuthentication.authorizationUrl);
                string loginTicket = await WaitForTicketAsync(startedAuthentication.transactionId, loginTransaction.Verifier, cancellationToken);
                if (intent == "link")
                {
                    LinkResponse linkedAccount = await authApiClient.LinkAsync(startedAuthentication.transactionId, loginTicket, loginTransaction.Verifier, session.AccessToken, cancellationToken);
                    session.UpdateUser(linkedAccount.user);
                    AppleLoginResult linkResult = new AppleLoginResult
                    {
                        User = linkedAccount.user,
                        AccessToken = session.AccessToken,
                        RefreshToken = session.RefreshToken
                    };
                    OnLoginSuccess?.Invoke(linkResult);
                    return linkResult;
                }

                AuthSessionResponse sessionResponse = await authApiClient.ExchangeAsync(startedAuthentication.transactionId, loginTicket, loginTransaction.Verifier, cancellationToken);
                session.Save(sessionResponse.accessToken, sessionResponse.refreshToken, sessionResponse.expiresIn, sessionResponse.user);
                AppleLoginResult loginResult = new AppleLoginResult
                {
                    User = sessionResponse.user,
                    AccessToken = sessionResponse.accessToken,
                    RefreshToken = sessionResponse.refreshToken,
                    ExpiresIn = sessionResponse.expiresIn
                };
                OnLoginSuccess?.Invoke(loginResult);
                return loginResult;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (AppleLoginException exception)
            {
                PublishFailure(exception);
                throw;
            }
            finally
            {
                busy = false;
            }
        }

        async Task<string> WaitForTicketAsync(string transactionId, string verifier, CancellationToken cancellationToken)
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
                    {
                        throw new AppleLoginException(AppleLoginErrorCode.ProviderError, string.IsNullOrEmpty(nativeAuthResult.message) ? "네이티브 인증에 실패했습니다." : nativeAuthResult.message);
                    }
                    if (!string.IsNullOrEmpty(nativeAuthResult.ticket)) return nativeAuthResult.ticket;
                }

                StatusResponse status = null;
                try
                {
                    status = await authApiClient.StatusAsync(transactionId, verifier, cancellationToken);
                }
                catch (AppleLoginException exception) when (exception.ErrorCode == AppleLoginErrorCode.Network)
                {
                    await Task.Delay(AppleLoginConstants.StatusPollMilliseconds, cancellationToken);
                    continue;
                }
                if (status != null && status.status == "ready" && !string.IsNullOrEmpty(status.ticket)) return status.ticket;
                if (status != null && status.status == "cancelled") throw new OperationCanceledException();
                if (status != null && (status.status == "failed" || status.status == "superseded"))
                {
                    throw new AppleLoginException(AppleLoginErrorCode.ProviderError, "인증 요청이 종료되었습니다.");
                }
                if (status != null && (status.status == "expired" || status.status == "exchanged"))
                {
                    throw new AppleLoginException(AppleLoginErrorCode.TicketExpired, "인증 요청이 만료되었습니다.");
                }
                await Task.Delay(AppleLoginConstants.StatusPollMilliseconds, cancellationToken);
            }
            throw new AppleLoginException(AppleLoginErrorCode.Timeout, "로그인 시간이 초과되었습니다.");
        }

        void RequireSession()
        {
            if (!session.HasRefreshToken) throw new AppleLoginException(AppleLoginErrorCode.NotAuthenticated, "로그인이 필요합니다.");
        }

        void PublishFailure(AppleLoginException exception)
        {
            Action<AppleLoginError> loginFailedHandler = OnLoginFailed;
            if (loginFailedHandler == null) return;
            loginFailedHandler(new AppleLoginError { Code = exception.ErrorCode, Message = exception.Message });
        }

        static string DeviceId()
        {
            string deviceIdentifier = SystemInfo.deviceUniqueIdentifier;
            if (string.IsNullOrEmpty(deviceIdentifier)) deviceIdentifier = "unknown-device";
            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] deviceIdentifierHash = sha256.ComputeHash(Encoding.UTF8.GetBytes("apple-login:" + deviceIdentifier));
                return LoginTransaction.Base64Url(deviceIdentifierHash);
            }
        }
    }

    public sealed class MockAppleLoginService : IAppleLoginService
    {
        readonly AppleLoginConfig config;
        readonly SessionManager session;
        bool busy;

        public MockAppleLoginService(AppleLoginConfig config, SessionManager session)
        {
            this.config = config;
            this.session = session;
        }

        public bool IsLoggedIn { get { return session.HasRefreshToken; } }
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
                await Task.Delay(150, cancellationToken);
                if (config != null && !config.mockLoginSucceeds)
                {
                    throw new AppleLoginException(AppleLoginErrorCode.ProviderError, "Mock 로그인이 실패하도록 설정되어 있습니다.");
                }
                AppleUser mockUser = new AppleUser
                {
                    id = "mock-user",
                    nickname = "Mock User",
                    email = "mock.user@privaterelay.appleid.com",
                    isPrivateEmail = true,
                    providerUserId = "mock.apple.user"
                };
                session.Save("mock-access", "mock-refresh", 900, mockUser);
                AppleLoginResult loginResult = new AppleLoginResult { User = mockUser, AccessToken = "mock-access", RefreshToken = "mock-refresh", ExpiresIn = 900 };
                if (OnLoginSuccess != null) OnLoginSuccess(loginResult);
                return loginResult;
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
            return Task.FromResult(session.HasRefreshToken);
        }

        public Task<AppleLoginResult> RefreshSessionAsync()
        {
            if (!session.HasRefreshToken) throw new AppleLoginException(AppleLoginErrorCode.NotAuthenticated, "로그인이 필요합니다.");
            session.UpdateAccess("mock-access", "mock-refresh", 900);
            return Task.FromResult(new AppleLoginResult
            {
                User = session.CurrentUser,
                AccessToken = "mock-access",
                RefreshToken = "mock-refresh",
                ExpiresIn = 900
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
            return LoginAsync(cancellationToken);
        }

        public Task UnlinkAsync()
        {
            session.UpdateUser(null);
            return Task.CompletedTask;
        }

        public Task DeleteAccountAsync(CancellationToken cancellationToken = default)
        {
            return LogoutAsync();
        }
    }
}
