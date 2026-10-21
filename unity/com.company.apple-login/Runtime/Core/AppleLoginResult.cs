using System;

namespace AppleLoginSDK
{
    [Serializable]
    public sealed class AppleUser
    {
        public string id;
        public string nickname;
        public string email;
        public bool isPrivateEmail;
        public string providerUserId;

        public string Id { get { return id; } }
        public string Nickname { get { return nickname; } }
        public string Email { get { return email; } }
        public bool IsPrivateEmail { get { return isPrivateEmail; } }
        public string ProviderUserId { get { return providerUserId; } }
    }

    [Serializable]
    public sealed class AppleLoginResult
    {
        public AppleUser User;
        public string AccessToken;
        public string RefreshToken;
        public int ExpiresIn;
    }
}
