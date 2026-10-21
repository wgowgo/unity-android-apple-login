using UnityEditor;
using UnityEngine;

namespace AppleLoginSDK.EditorTools
{
    public sealed class AppleLoginSettingsEditor : EditorWindow
    {
        AppleLoginConfig config;

        [MenuItem("Apple Login/Settings")]
        public static void Open()
        {
            GetWindow<AppleLoginSettingsEditor>("Apple Login Settings");
        }

        void OnEnable()
        {
            config = FindConfig();
        }

        void OnGUI()
        {
            EditorGUILayout.LabelField("Apple Login Settings", EditorStyles.boldLabel);

            if (config == null)
            {
                if (GUILayout.Button("설정 에셋 만들기")) CreateConfig();
                return;
            }

            EditorGUI.BeginChangeCheck();
            config.servicesId = EditorGUILayout.TextField("Services ID", config.servicesId);
            config.useDirectAppleLogin = EditorGUILayout.Toggle("직접 Apple 로그인", config.useDirectAppleLogin);
            if (config.useDirectAppleLogin)
                config.redirectUri = EditorGUILayout.TextField("Redirect URI", config.redirectUri);
            config.authServerUrl = EditorGUILayout.TextField("Authentication Server URL", config.authServerUrl);
            config.androidPackageName = EditorGUILayout.TextField("Android Package Name", config.androidPackageName);
            config.debugLogging = EditorGUILayout.Toggle("Debug Logging 활성화 (민감정보 제외)", config.debugLogging);
            config.useOfflineMockInEditor = EditorGUILayout.Toggle("에디터에서 오프라인 Mock 사용", config.useOfflineMockInEditor);
            config.mockLoginSucceeds = EditorGUILayout.Toggle("Mock 로그인 성공", config.mockLoginSucceeds);
            if (EditorGUI.EndChangeCheck())
            {
                EditorUtility.SetDirty(config);
                AssetDatabase.SaveAssets();
            }

            string validationMessage = AndroidManifestValidator.Validate(config);
            if (string.IsNullOrEmpty(validationMessage)) EditorGUILayout.HelpBox("설정 검증을 통과했습니다.", MessageType.None);
            else EditorGUILayout.HelpBox(validationMessage, MessageType.Warning);

            if (GUILayout.Button("Android App Link 매니페스트 생성"))
            {
                AndroidManifestValidator.Generate(config);
            }
            if (GUILayout.Button("설정 JSON 복사"))
            {
                EditorGUIUtility.systemCopyBuffer = AndroidManifestValidator.ConfigurationJson(config);
            }
        }

        static AppleLoginConfig FindConfig()
        {
            string[] configAssetGuids = AssetDatabase.FindAssets("t:AppleLoginConfig");
            if (configAssetGuids.Length == 0) return null;
            return AssetDatabase.LoadAssetAtPath<AppleLoginConfig>(AssetDatabase.GUIDToAssetPath(configAssetGuids[0]));
        }

        void CreateConfig()
        {
            if (!AssetDatabase.IsValidFolder("Assets/Resources")) AssetDatabase.CreateFolder("Assets", "Resources");
            config = ScriptableObject.CreateInstance<AppleLoginConfig>();
            AssetDatabase.CreateAsset(config, "Assets/Resources/AppleLoginSettings.asset");
            AssetDatabase.SaveAssets();
        }
    }
}
