using System;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace AppleLoginSDK
{
    public sealed class AppleIdTokenPayload
    {
        public string sub;
        public int exp;
    }

    public static class AppleIdTokenVerifier
    {
        const string KeysUrl = "https://appleid.apple.com/auth/keys";
        const string Issuer = "https://appleid.apple.com";
        static JwksResponse cache;
        static long cacheExpiresAt;

        public static async Task<AppleIdTokenPayload> VerifyAsync(string idToken, string servicesId, string nonce, CancellationToken cancellationToken)
        {
            if (string.IsNullOrEmpty(idToken)) throw new AppleLoginException(AppleLoginErrorCode.TokenExchangeFailed, "ID Token이 없습니다.");
            string[] tokenParts = idToken.Split('.');
            if (tokenParts.Length != 3) throw new AppleLoginException(AppleLoginErrorCode.TokenExchangeFailed, "ID Token 형식이 올바르지 않습니다.");

            string headerJson = Encoding.UTF8.GetString(Base64UrlDecode(tokenParts[0]));
            JwtHeader header = JsonUtility.FromJson<JwtHeader>(headerJson);
            if (header == null || header.alg != "RS256" || string.IsNullOrEmpty(header.kid))
                throw new AppleLoginException(AppleLoginErrorCode.TokenExchangeFailed, "ID Token 서명 알고리즘이 올바르지 않습니다.");

            string payloadJson = Encoding.UTF8.GetString(Base64UrlDecode(tokenParts[1]));
            JwtPayload payload = JsonUtility.FromJson<JwtPayload>(payloadJson);
            if (payload == null || string.IsNullOrEmpty(payload.sub))
                throw new AppleLoginException(AppleLoginErrorCode.TokenExchangeFailed, "Apple 사용자 식별자가 없습니다.");
            if (payload.iss != Issuer)
                throw new AppleLoginException(AppleLoginErrorCode.TokenExchangeFailed, "ID Token 발급자가 올바르지 않습니다.");
            if (payload.aud != servicesId)
                throw new AppleLoginException(AppleLoginErrorCode.TokenExchangeFailed, "ID Token 대상이 Services ID와 다릅니다.");
            if (payload.nonce != nonce)
                throw new AppleLoginException(AppleLoginErrorCode.InvalidState, "Nonce가 로그인 요청과 일치하지 않습니다.");

            long currentUnixTimeSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (payload.exp + 60 < currentUnixTimeSeconds)
                throw new AppleLoginException(AppleLoginErrorCode.SessionExpired, "ID Token이 만료되었습니다.");
            if (payload.iat > currentUnixTimeSeconds + 60)
                throw new AppleLoginException(AppleLoginErrorCode.TokenExchangeFailed, "ID Token 발급 시각이 올바르지 않습니다.");

            Jwk signingKey = await FindKeyAsync(header.kid, cancellationToken);
            if (signingKey == null) throw new AppleLoginException(AppleLoginErrorCode.TokenExchangeFailed, "Apple 공개 키를 찾지 못했습니다.");
            if (!VerifySignature(tokenParts[0] + "." + tokenParts[1], tokenParts[2], signingKey))
                throw new AppleLoginException(AppleLoginErrorCode.TokenExchangeFailed, "ID Token 서명 검증에 실패했습니다.");

            return new AppleIdTokenPayload { sub = payload.sub, exp = payload.exp };
        }

        static async Task<Jwk> FindKeyAsync(string keyId, CancellationToken cancellationToken)
        {
            long currentUnixTimeSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            Jwk cachedKey = Find(cache, keyId);
            if (cachedKey != null && currentUnixTimeSeconds < cacheExpiresAt) return cachedKey;
            cache = await FetchKeysAsync(cancellationToken);
            cacheExpiresAt = currentUnixTimeSeconds + 3600;
            cachedKey = Find(cache, keyId);
            if (cachedKey != null) return cachedKey;
            cache = await FetchKeysAsync(cancellationToken);
            cacheExpiresAt = currentUnixTimeSeconds + 3600;
            return Find(cache, keyId);
        }

        static Jwk Find(JwksResponse jsonWebKeySet, string keyId)
        {
            if (jsonWebKeySet == null || jsonWebKeySet.keys == null) return null;
            for (int keyIndex = 0; keyIndex < jsonWebKeySet.keys.Length; keyIndex++)
            {
                Jwk candidateKey = jsonWebKeySet.keys[keyIndex];
                if (candidateKey != null && candidateKey.kid == keyId && candidateKey.kty == "RSA") return candidateKey;
            }
            return null;
        }

        static async Task<JwksResponse> FetchKeysAsync(CancellationToken cancellationToken)
        {
            using (UnityWebRequest keysRequest = UnityWebRequest.Get(KeysUrl))
            {
                keysRequest.timeout = 20;
                UnityWebRequestAsyncOperation keysOperation = keysRequest.SendWebRequest();
                while (!keysOperation.isDone)
                {
                    if (cancellationToken.IsCancellationRequested)
                    {
                        keysRequest.Abort();
                        cancellationToken.ThrowIfCancellationRequested();
                    }
                    await Task.Yield();
                }
                if (keysRequest.result != UnityWebRequest.Result.Success)
                    throw new AppleLoginException(AppleLoginErrorCode.Network, "Apple 공개 키를 가져오지 못했습니다.");
                return JsonUtility.FromJson<JwksResponse>(keysRequest.downloadHandler.text);
            }
        }

        static bool VerifySignature(string signingInput, string signaturePart, Jwk jsonWebKey)
        {
            try
            {
                using (RSA rsa = RSA.Create())
                {
                    rsa.ImportParameters(new RSAParameters
                    {
                        Modulus = Base64UrlDecode(jsonWebKey.n),
                        Exponent = Base64UrlDecode(jsonWebKey.e)
                    });
                    return rsa.VerifyData(
                        Encoding.ASCII.GetBytes(signingInput),
                        Base64UrlDecode(signaturePart),
                        HashAlgorithmName.SHA256,
                        RSASignaturePadding.Pkcs1);
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        static byte[] Base64UrlDecode(string value)
        {
            string paddedBase64 = value.Replace('-', '+').Replace('_', '/');
            switch (paddedBase64.Length % 4)
            {
                case 2: paddedBase64 += "=="; break;
                case 3: paddedBase64 += "="; break;
            }
            return Convert.FromBase64String(paddedBase64);
        }

        [Serializable]
        sealed class JwtHeader
        {
            public string alg;
            public string kid;
        }

        [Serializable]
        sealed class JwtPayload
        {
            public string iss;
            public string aud;
            public string sub;
            public string nonce;
            public int exp;
            public int iat;
        }

        [Serializable]
        sealed class JwksResponse
        {
            public Jwk[] keys;
        }

        [Serializable]
        sealed class Jwk
        {
            public string kid;
            public string kty;
            public string n;
            public string e;
        }
    }
}
