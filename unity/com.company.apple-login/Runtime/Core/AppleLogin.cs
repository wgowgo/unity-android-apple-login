namespace AppleLoginSDK
{
    public static class AppleLogin
    {
        static IAppleLoginService current;

        public static IAppleLoginService Default
        {
            get
            {
                if (current == null) current = CreateDefault();
                return current;
            }
        }

        public static void SetService(IAppleLoginService service)
        {
            current = service;
        }

        public static IAppleLoginService CreateDefault()
        {
            AppleLoginConfig loginConfig = AppleLoginConfig.Load();
            SessionManager sessionManager = new SessionManager(TokenStorage.Create());
#if UNITY_EDITOR
            if (loginConfig.useOfflineMockInEditor) return new MockAppleLoginService(loginConfig, sessionManager);
            if (loginConfig.useDirectAppleLogin) return new DirectAppleLoginService(loginConfig, sessionManager, new EditorAuthBrowser());
            return new AppleLoginService(loginConfig, new AppleAuthApiClient(loginConfig), sessionManager, new EditorAuthBrowser());
#elif UNITY_ANDROID
            if (loginConfig.useDirectAppleLogin) return new DirectAppleLoginService(loginConfig, sessionManager, new AndroidNativeBridge());
            return new AppleLoginService(loginConfig, new AppleAuthApiClient(loginConfig), sessionManager, new AndroidNativeBridge());
#else
            return new MockAppleLoginService(loginConfig, sessionManager);
#endif
        }
    }
}
