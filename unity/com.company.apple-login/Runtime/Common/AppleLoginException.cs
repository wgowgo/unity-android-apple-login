using System;

namespace AppleLoginSDK
{
    public enum AppleLoginErrorCode
    {
        Cancelled,
        Network,
        InvalidState,
        TokenExchangeFailed,
        TicketExpired,
        TicketInvalid,
        ProviderError,
        ServerError,
        AlreadyInProgress,
        NotAuthenticated,
        AccountConflict,
        SessionExpired,
        Timeout,
        Configuration
    }

    public sealed class AppleLoginError
    {
        public AppleLoginErrorCode Code;
        public string Message;
    }

    public sealed class AppleLoginException : Exception
    {
        public AppleLoginErrorCode ErrorCode { get; }

        public AppleLoginException(AppleLoginErrorCode errorCode, string message) : base(message)
        {
            ErrorCode = errorCode;
        }
    }
}
