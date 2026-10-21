using System;
using System.IO;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace AppleLoginSDK.EditorTools
{
    public static class AndroidManifestValidator
    {
        public const string ManifestRelativePath = "Assets/Plugins/Android/AppleLoginLinks.androidlib/AndroidManifest.xml";

        public static string Validate(AppleLoginConfig config)
        {
            if (config == null) return "설정 에셋이 없습니다.";
            if (string.IsNullOrWhiteSpace(config.servicesId) || !Regex.IsMatch(config.servicesId, @"^[A-Za-z0-9.\-]+$"))
            {
                return "Services ID 형식을 확인해 주세요.";
            }
            if (config.useDirectAppleLogin)
            {
                Uri redirect;
                if (!Uri.TryCreate(config.redirectUri, UriKind.Absolute, out redirect) || redirect.Scheme != "https")
                    return "Redirect URI는 HTTPS 주소여야 합니다.";
                return null;
            }
            Uri server;
            if (!Uri.TryCreate(config.authServerUrl, UriKind.Absolute, out server) || (server.Scheme != "https" && !IsLocal(server)))
            {
                return "인증 서버는 HTTPS 주소여야 합니다.";
            }
            if (string.IsNullOrWhiteSpace(config.androidPackageName) || !Regex.IsMatch(config.androidPackageName, @"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$"))
            {
                return "Android 패키지명 형식을 확인해 주세요.";
            }

            string manifestAbsolutePath = Path.Combine(Directory.GetCurrentDirectory(), ManifestRelativePath);
            if (!File.Exists(manifestAbsolutePath)) return "App Link 매니페스트가 아직 생성되지 않았습니다.";
            string manifestXml = File.ReadAllText(manifestAbsolutePath);
            if (!manifestXml.Contains(server.Host) || !manifestXml.Contains("/auth/mobile/complete"))
            {
                return "App Link 매니페스트의 호스트 또는 경로가 인증 서버와 다릅니다.";
            }
            if (!manifestXml.Contains("AppleAuthCallbackActivity")) return "콜백 Activity가 매니페스트에 없습니다.";
            return null;
        }

        public static void Generate(AppleLoginConfig config)
        {
            string generationError = ValidateGeneration(config);
            if (generationError != null) throw new InvalidOperationException(generationError);
            Uri authServerUri = new Uri(config.authServerUrl);
            string androidLibraryDirectory = Path.Combine(Directory.GetCurrentDirectory(), "Assets/Plugins/Android/AppleLoginLinks.androidlib");
            Directory.CreateDirectory(androidLibraryDirectory);
            File.WriteAllText(Path.Combine(androidLibraryDirectory, "project.properties"), "android.library=true\ntarget=android-36\n");
            File.WriteAllText(Path.Combine(androidLibraryDirectory, "AndroidManifest.xml"), Manifest(authServerUri.Host));
            AssetDatabase.Refresh();
        }

        public static string ConfigurationJson(AppleLoginConfig config)
        {
            return "{\n  \"servicesId\": \"" + Escape(config.servicesId) + "\",\n  \"authServerUrl\": \"" + Escape(config.authServerUrl) + "\",\n  \"androidPackageName\": \"" + Escape(config.androidPackageName) + "\"\n}\n";
        }

        static string ValidateGeneration(AppleLoginConfig config)
        {
            if (config == null) return "설정 에셋이 없습니다.";
            Uri server;
            if (!Uri.TryCreate(config.authServerUrl, UriKind.Absolute, out server)) return "인증 서버 주소가 올바르지 않습니다.";
            if (server.Scheme != "https" && !IsLocal(server)) return "App Link 호스트는 HTTPS 인증 서버여야 합니다.";
            if (string.IsNullOrWhiteSpace(server.Host)) return "인증 서버 호스트가 없습니다.";
            return null;
        }

        static bool IsLocal(Uri server)
        {
            return server.Scheme == "http" && (server.Host == "localhost" || server.Host == "127.0.0.1");
        }

        static string Manifest(string host)
        {
            return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" +
                   "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"com.company.applelogin.links\">\n" +
                   "  <application>\n" +
                   "    <activity android:name=\"com.company.applelogin.AppleAuthCallbackActivity\" android:exported=\"true\">\n" +
                   "      <intent-filter android:autoVerify=\"true\">\n" +
                   "        <action android:name=\"android.intent.action.VIEW\" />\n" +
                   "        <category android:name=\"android.intent.category.DEFAULT\" />\n" +
                   "        <category android:name=\"android.intent.category.BROWSABLE\" />\n" +
                   "        <data android:scheme=\"https\" android:host=\"" + host + "\" android:pathPrefix=\"/auth/mobile/complete\" />\n" +
                   "      </intent-filter>\n" +
                   "    </activity>\n" +
                   "  </application>\n" +
                   "</manifest>\n";
        }

        static string Escape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
