using System;
using System.Threading;
using System.Threading.Tasks;

namespace AppleLoginSDK
{
    public interface IAppleLoginService
    {
        Task<AppleLoginResult> LoginAsync(CancellationToken cancellationToken = default);
        Task<bool> RestoreSessionAsync();
        Task<AppleLoginResult> RefreshSessionAsync();
        Task LogoutAsync();
        Task<AppleLoginResult> LinkAsync(CancellationToken cancellationToken = default);
        Task UnlinkAsync();
        Task DeleteAccountAsync(CancellationToken cancellationToken = default);
        bool IsLoggedIn { get; }
        AppleUser CurrentUser { get; }
        event Action<AppleLoginResult> OnLoginSuccess;
        event Action<AppleLoginError> OnLoginFailed;
        event Action OnLogout;
    }
}
