using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace AppleLoginSDK
{
    public sealed class AppleAuthApiClient
    {
        readonly AppleLoginConfig config;

        public AppleAuthApiClient(AppleLoginConfig config)
        {
            this.config = config;
        }

        public Task<StartResponse> StartAsync(string challenge, string intent, string deviceId, string accessToken, CancellationToken cancellationToken)
        {
            StartRequest startRequest = new StartRequest { verifierChallenge = challenge, intent = intent, deviceId = deviceId };
            return SendAsync<StartResponse>("/auth/apple/start", "POST", JsonUtility.ToJson(startRequest), accessToken, cancellationToken);
        }

        public Task<AuthSessionResponse> ExchangeAsync(string transactionId, string ticket, string verifier, CancellationToken cancellationToken)
        {
            ExchangeRequest exchangeRequest = new ExchangeRequest { transactionId = transactionId, ticket = ticket, verifier = verifier };
            return SendAsync<AuthSessionResponse>("/auth/apple/exchange", "POST", JsonUtility.ToJson(exchangeRequest), null, cancellationToken);
        }

        public Task<StatusResponse> StatusAsync(string transactionId, string verifier, CancellationToken cancellationToken)
        {
            return SendAsync<StatusResponse>(
                "/auth/apple/status?transactionId=" + UnityEngine.Networking.UnityWebRequest.EscapeURL(transactionId),
                "GET",
                null,
                null,
                cancellationToken,
                verifier);
        }

        public Task<RefreshResponse> RefreshAsync(string refreshToken, CancellationToken cancellationToken)
        {
            return SendAsync<RefreshResponse>("/auth/refresh", "POST", JsonUtility.ToJson(new RefreshRequest { refreshToken = refreshToken }), null, cancellationToken);
        }

        public Task LogoutAsync(string accessToken, CancellationToken cancellationToken)
        {
            return SendAsync<StatusResponse>("/auth/logout", "POST", "{}", accessToken, cancellationToken);
        }

        public Task<AppleUser> MeAsync(string accessToken, CancellationToken cancellationToken)
        {
            return SendAsync<AppleUser>("/auth/me", "GET", null, accessToken, cancellationToken);
        }

        public Task<LinkResponse> LinkAsync(string transactionId, string ticket, string verifier, string accessToken, CancellationToken cancellationToken)
        {
            ExchangeRequest linkRequest = new ExchangeRequest { transactionId = transactionId, ticket = ticket, verifier = verifier };
            return SendAsync<LinkResponse>("/auth/apple/link", "POST", JsonUtility.ToJson(linkRequest), accessToken, cancellationToken);
        }

        public Task UnlinkAsync(string accessToken, CancellationToken cancellationToken)
        {
            return SendAsync<StatusResponse>("/auth/apple/link", "DELETE", null, accessToken, cancellationToken);
        }

        public Task DeleteAccountAsync(string transactionId, string ticket, string verifier, string accessToken, CancellationToken cancellationToken)
        {
            ExchangeRequest deleteAccountRequest = new ExchangeRequest { transactionId = transactionId, ticket = ticket, verifier = verifier };
            return SendAsync<StatusResponse>("/auth/account/delete", "POST", JsonUtility.ToJson(deleteAccountRequest), accessToken, cancellationToken);
        }

        async Task<T> SendAsync<T>(string path, string method, string json, string accessToken, CancellationToken cancellationToken, string verifier = null)
        {
            if (config == null || string.IsNullOrWhiteSpace(config.authServerUrl))
            {
                throw new AppleLoginException(AppleLoginErrorCode.Configuration, "인증 서버 주소가 없습니다.");
            }

            string requestUrl = config.authServerUrl.TrimEnd('/') + path;
            using (UnityWebRequest request = new UnityWebRequest(requestUrl, method))
            {
                if (!string.IsNullOrEmpty(json))
                {
                    request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                    request.SetRequestHeader("Content-Type", "application/json");
                }
                request.downloadHandler = new DownloadHandlerBuffer();
                request.timeout = 20;
                if (!string.IsNullOrEmpty(accessToken)) request.SetRequestHeader("Authorization", "Bearer " + accessToken);
                if (!string.IsNullOrEmpty(verifier)) request.SetRequestHeader("X-Login-Verifier", verifier);

                UnityWebRequestAsyncOperation requestOperation = request.SendWebRequest();
                while (!requestOperation.isDone)
                {
                    if (cancellationToken.IsCancellationRequested)
                    {
                        request.Abort();
                        cancellationToken.ThrowIfCancellationRequested();
                    }
                    await Task.Yield();
                }

                if (request.result == UnityWebRequest.Result.ConnectionError || request.result == UnityWebRequest.Result.DataProcessingError)
                {
                    throw new AppleLoginException(AppleLoginErrorCode.Network, "인증 서버에 연결하지 못했습니다.");
                }

                string responseText = request.downloadHandler != null ? request.downloadHandler.text : "";
                if (request.result != UnityWebRequest.Result.Success)
                {
                    throw MapHttpError(request.responseCode, responseText);
                }
                if (string.IsNullOrEmpty(responseText) || request.responseCode == 204)
                {
                    return default;
                }
                return JsonUtility.FromJson<T>(responseText);
            }
        }

        static AppleLoginException MapHttpError(long status, string body)
        {
            ApiErrorBody errorBody = string.IsNullOrEmpty(body) ? null : JsonUtility.FromJson<ApiErrorBody>(body);
            string errorCode = errorBody != null ? errorBody.code : null;
            string errorMessage = errorBody != null && !string.IsNullOrEmpty(errorBody.message) ? errorBody.message : "인증 요청이 실패했습니다.";
            switch (errorCode)
            {
                case "TICKET_EXPIRED":
                case "INVALID_TICKET":
                    return new AppleLoginException(AppleLoginErrorCode.TicketExpired, errorMessage);
                case "VERIFIER_MISMATCH":
                    return new AppleLoginException(AppleLoginErrorCode.TicketInvalid, errorMessage);
                case "INVALID_STATE":
                case "INVALID_NONCE":
                    return new AppleLoginException(AppleLoginErrorCode.InvalidState, errorMessage);
                case "TOKEN_EXCHANGE_FAILED":
                case "ID_TOKEN_INVALID":
                    return new AppleLoginException(AppleLoginErrorCode.TokenExchangeFailed, errorMessage);
                case "ACCOUNT_CONFLICT":
                    return new AppleLoginException(AppleLoginErrorCode.AccountConflict, errorMessage);
                case "UNAUTHORIZED":
                case "SESSION_REUSE":
                    return new AppleLoginException(AppleLoginErrorCode.SessionExpired, errorMessage);
                case "NOT_LINKED":
                    return new AppleLoginException(AppleLoginErrorCode.NotAuthenticated, errorMessage);
                default:
                    if (status == 401) return new AppleLoginException(AppleLoginErrorCode.SessionExpired, errorMessage);
                    return new AppleLoginException(AppleLoginErrorCode.ServerError, errorMessage);
            }
        }
    }
}
