using System;
using UnityEngine;
using UnityEngine.Scripting;

namespace AppleLoginSDK
{
    public struct NativeAuthResult
    {
        public string status;
        public string ticket;
        public string idToken;
        public string state;
        public string code;
        public string message;
    }

    public interface IAuthBrowser
    {
        void Open(string authorizationUrl);
        bool TryConsume(out NativeAuthResult result);
    }

    public sealed class EditorAuthBrowser : IAuthBrowser
    {
        public void Open(string authorizationUrl)
        {
            Application.OpenURL(authorizationUrl);
        }

        public bool TryConsume(out NativeAuthResult result)
        {
            result = default;
            return false;
        }
    }

    public sealed class AndroidCallbackReceiver : MonoBehaviour
    {
        public static AndroidCallbackReceiver Instance { get; private set; }
        readonly System.Collections.Generic.Queue<string> pending = new System.Collections.Generic.Queue<string>();

        public static AndroidCallbackReceiver Ensure()
        {
            if (Instance != null) return Instance;
            GameObject existingCallbackObject = GameObject.Find(AppleLoginConstants.CallbackObjectName);
            GameObject callbackHost = existingCallbackObject != null ? existingCallbackObject : new GameObject(AppleLoginConstants.CallbackObjectName);
            DontDestroyOnLoad(callbackHost);
            AndroidCallbackReceiver receiver = callbackHost.GetComponent<AndroidCallbackReceiver>();
            return receiver != null ? receiver : callbackHost.AddComponent<AndroidCallbackReceiver>();
        }

        void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            gameObject.name = AppleLoginConstants.CallbackObjectName;
            DontDestroyOnLoad(gameObject);
        }

        [Preserve]
        public void OnNativeResult(string json)
        {
            if (!string.IsNullOrEmpty(json)) pending.Enqueue(json);
        }

        public bool TryDequeue(out string json)
        {
            if (pending.Count == 0)
            {
                json = null;
                return false;
            }
            json = pending.Dequeue();
            return true;
        }
    }

    public sealed class AndroidNativeBridge : IAuthBrowser
    {
        public void Open(string authorizationUrl)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            AndroidCallbackReceiver.Ensure();
            using (AndroidJavaClass unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (AndroidJavaObject currentActivity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity"))
            using (AndroidJavaClass loginBridge = new AndroidJavaClass(AppleLoginConstants.NativeBridgeClass))
            {
                loginBridge.CallStatic("start", currentActivity, authorizationUrl, AppleLoginConstants.CallbackObjectName);
            }
#else
            throw new AppleLoginException(AppleLoginErrorCode.Configuration, "Android 네이티브 로그인은 실기기 빌드에서만 사용할 수 있습니다.");
#endif
        }

        public bool TryConsume(out NativeAuthResult result)
        {
            result = default;
            string resultJson = null;
            if (AndroidCallbackReceiver.Instance != null && AndroidCallbackReceiver.Instance.TryDequeue(out resultJson))
            {
                result = JsonUtility.FromJson<NativeAuthResultDto>(resultJson).ToResult();
                return true;
            }
#if UNITY_ANDROID && !UNITY_EDITOR
            using (AndroidJavaClass unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (AndroidJavaObject currentActivity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity"))
            using (AndroidJavaClass loginBridge = new AndroidJavaClass(AppleLoginConstants.NativeBridgeClass))
            {
                resultJson = loginBridge.CallStatic<string>("consumePendingResult", currentActivity);
            }
            if (string.IsNullOrEmpty(resultJson)) return false;
            result = JsonUtility.FromJson<NativeAuthResultDto>(resultJson).ToResult();
            return true;
#else
            return false;
#endif
        }
    }

    public sealed class AndroidTokenStorage : ITokenStorage
    {
        public void Save(string storageKey, string storageValue)
        {
            Call("saveSecure", storageKey, storageValue ?? "");
        }

        public string Load(string storageKey)
        {
            return CallString("loadSecure", storageKey);
        }

        public void Clear()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            using (AndroidJavaClass unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (AndroidJavaObject currentActivity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity"))
            using (AndroidJavaClass loginBridge = new AndroidJavaClass(AppleLoginConstants.NativeBridgeClass))
            {
                loginBridge.CallStatic("clearSecure", currentActivity);
            }
#endif
        }

        static void Call(string bridgeMethodName, string storageKey, string storageValue)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            using (AndroidJavaClass unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (AndroidJavaObject currentActivity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity"))
            using (AndroidJavaClass loginBridge = new AndroidJavaClass(AppleLoginConstants.NativeBridgeClass))
            {
                loginBridge.CallStatic(bridgeMethodName, currentActivity, storageKey, storageValue);
            }
#endif
        }

        static string CallString(string bridgeMethodName, string storageKey)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            using (AndroidJavaClass unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (AndroidJavaObject currentActivity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity"))
            using (AndroidJavaClass loginBridge = new AndroidJavaClass(AppleLoginConstants.NativeBridgeClass))
            {
                return loginBridge.CallStatic<string>(bridgeMethodName, currentActivity, storageKey);
            }
#else
            return "";
#endif
        }
    }

    [Serializable]
    sealed class NativeAuthResultDto
    {
        public string status;
        public string ticket;
        public string idToken;
        public string state;
        public string code;
        public string message;

        public NativeAuthResult ToResult()
        {
            return new NativeAuthResult
            {
                status = status,
                ticket = ticket,
                idToken = idToken,
                state = state,
                code = code,
                message = message
            };
        }
    }
}
