using System;
using System.Threading;
using UnityEngine;

namespace AppleLoginSDK.Samples
{
    public sealed class LoginExample : MonoBehaviour
    {
        string status = "대기 중";

        public async void OnAppleLoginClick()
        {
            try
            {
                AppleLoginResult loginResult = await AppleLogin.Default.LoginAsync();
                status = "로그인: " + loginResult.User.Id + " / " + loginResult.User.Nickname;
                Debug.Log("Login: " + loginResult.User.Id);
                Debug.Log("Name: " + loginResult.User.Nickname);
            }
            catch (OperationCanceledException)
            {
                status = "로그인 취소";
                Debug.Log("Login cancelled");
            }
            catch (AppleLoginException exception)
            {
                status = "실패: " + exception.ErrorCode;
                Debug.LogError("Login failed: " + exception.ErrorCode);
            }
        }

        async void OnRestoreClick()
        {
            bool sessionRestored = await AppleLogin.Default.RestoreSessionAsync();
            status = sessionRestored ? "세션 복원" : "세션 없음";
        }

        async void OnLogoutClick()
        {
            await AppleLogin.Default.LogoutAsync();
            status = "로그아웃";
        }

        void OnGUI()
        {
            GUILayout.BeginArea(new Rect(40, 40, 420, 240));
            GUILayout.Label("Sign in with Apple");
            GUILayout.Label(status);
            if (GUILayout.Button("Apple로 로그인")) OnAppleLoginClick();
            if (GUILayout.Button("세션 복원")) OnRestoreClick();
            if (GUILayout.Button("로그아웃")) OnLogoutClick();
            GUILayout.EndArea();
        }
    }
}
