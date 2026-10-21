using UnityEngine;

namespace AppleLoginSDK
{
    [CreateAssetMenu(fileName = "AppleLoginSettings", menuName = "Apple Login/Settings")]
    public sealed class AppleLoginConfig : ScriptableObject
    {
        public string servicesId = "com.company.login";
        public string authServerUrl = "http://localhost:3000";
        public string redirectUri = "";
        public bool useDirectAppleLogin;
        public string androidPackageName = "com.company.game";
        public bool debugLogging;
        public bool useOfflineMockInEditor = true;
        public bool mockLoginSucceeds = true;

        public static AppleLoginConfig Load()
        {
            AppleLoginConfig loadedConfig = Resources.Load<AppleLoginConfig>("AppleLoginSettings");
            return loadedConfig != null ? loadedConfig : CreateInstance<AppleLoginConfig>();
        }
    }
}
