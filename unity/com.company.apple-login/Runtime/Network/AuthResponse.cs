using System;

namespace AppleLoginSDK
{
    [Serializable]
    public sealed class StartRequest
    {
        public string verifierChallenge;
        public string intent;
        public string deviceId;
    }

    [Serializable]
    public sealed class StartResponse
    {
        public string transactionId;
        public string authorizationUrl;
        public int expiresIn;
    }

    [Serializable]
    public sealed class ExchangeRequest
    {
        public string transactionId;
        public string ticket;
        public string verifier;
    }

    [Serializable]
    public sealed class AuthSessionResponse
    {
        public string accessToken;
        public string refreshToken;
        public int expiresIn;
        public AppleUser user;
    }

    [Serializable]
    public sealed class RefreshRequest
    {
        public string refreshToken;
    }

    [Serializable]
    public sealed class RefreshResponse
    {
        public string accessToken;
        public string refreshToken;
        public int expiresIn;
    }

    [Serializable]
    public sealed class StatusResponse
    {
        public string status;
        public string ticket;
    }

    [Serializable]
    public sealed class ApiErrorBody
    {
        public int statusCode;
        public string code;
        public string message;
    }

    [Serializable]
    public sealed class LinkResponse
    {
        public bool linked;
        public AppleUser user;
    }
}
