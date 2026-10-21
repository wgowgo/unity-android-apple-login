using UnityEngine;

namespace AppleLoginSDK
{
    public interface ITokenStorage
    {
        void Save(string storageKey, string storageValue);
        string Load(string storageKey);
        void Clear();
    }

    public static class TokenStorage
    {
        public static ITokenStorage Create()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            return new AndroidTokenStorage();
#else
            return new PlayerPrefsTokenStorage();
#endif
        }
    }

    public sealed class PlayerPrefsTokenStorage : ITokenStorage
    {
        const string Prefix = "applelogin.";

        public void Save(string storageKey, string storageValue)
        {
            PlayerPrefs.SetString(Prefix + storageKey, storageValue ?? "");
            PlayerPrefs.Save();
        }

        public string Load(string storageKey)
        {
            return PlayerPrefs.GetString(Prefix + storageKey, "");
        }

        public void Clear()
        {
            PlayerPrefs.DeleteKey(Prefix + "access");
            PlayerPrefs.DeleteKey(Prefix + "refresh");
            PlayerPrefs.DeleteKey(Prefix + "expiry");
            PlayerPrefs.DeleteKey(Prefix + "user");
            PlayerPrefs.Save();
        }
    }
}
