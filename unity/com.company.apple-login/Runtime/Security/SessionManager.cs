using System;
using System.Globalization;

namespace AppleLoginSDK
{
    public sealed class SessionManager
    {
        readonly ITokenStorage storage;
        AppleUser currentUser;
        string accessToken;
        string refreshToken;
        DateTime accessExpiresAtUtc;

        public SessionManager(ITokenStorage storage)
        {
            this.storage = storage;
            accessToken = storage.Load("access");
            refreshToken = storage.Load("refresh");
            string storedUserJson = storage.Load("user");
            if (!string.IsNullOrEmpty(storedUserJson)) currentUser = UnityEngine.JsonUtility.FromJson<AppleUser>(storedUserJson);
            DateTime parsed;
            if (DateTime.TryParse(storage.Load("expiry"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out parsed))
            {
                accessExpiresAtUtc = parsed.ToUniversalTime();
            }
        }

        public bool HasRefreshToken { get { return !string.IsNullOrEmpty(refreshToken); } }
        public string AccessToken { get { return accessToken; } }
        public string RefreshToken { get { return refreshToken; } }
        public AppleUser CurrentUser { get { return currentUser; } }
        public bool AccessValid { get { return !string.IsNullOrEmpty(accessToken) && accessExpiresAtUtc > DateTime.UtcNow.AddSeconds(30); } }

        public void Save(string newAccessToken, string newRefreshToken, int expiresIn, AppleUser user)
        {
            accessToken = newAccessToken ?? "";
            refreshToken = newRefreshToken ?? "";
            currentUser = user;
            accessExpiresAtUtc = DateTime.UtcNow.AddSeconds(expiresIn);
            storage.Save("access", accessToken);
            storage.Save("refresh", refreshToken);
            storage.Save("expiry", accessExpiresAtUtc.ToString("o", CultureInfo.InvariantCulture));
            storage.Save("user", user != null ? UnityEngine.JsonUtility.ToJson(user) : "");
        }

        public void UpdateAccess(string newAccessToken, string newRefreshToken, int expiresIn)
        {
            Save(newAccessToken, newRefreshToken, expiresIn, currentUser);
        }

        public void UpdateUser(AppleUser user)
        {
            currentUser = user;
            storage.Save("user", user != null ? UnityEngine.JsonUtility.ToJson(user) : "");
        }

        public void Clear()
        {
            accessToken = "";
            refreshToken = "";
            currentUser = null;
            accessExpiresAtUtc = DateTime.MinValue;
            storage.Clear();
        }
    }
}
