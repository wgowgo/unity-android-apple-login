using System.Security.Cryptography;
using System.Text;

namespace AppleLoginSDK
{
    public sealed class LoginTransaction
    {
        public string Verifier { get; }
        public string Challenge { get; }

        LoginTransaction(string verifier, string challenge)
        {
            Verifier = verifier;
            Challenge = challenge;
        }

        public static LoginTransaction Create()
        {
            byte[] randomBytes = new byte[32];
            using (RandomNumberGenerator randomNumberGenerator = RandomNumberGenerator.Create())
            {
                randomNumberGenerator.GetBytes(randomBytes);
            }
            return FromVerifier(Base64Url(randomBytes));
        }

        public static LoginTransaction FromVerifier(string verifier)
        {
            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] verifierHash = sha256.ComputeHash(Encoding.UTF8.GetBytes(verifier));
                return new LoginTransaction(verifier, Base64Url(verifierHash));
            }
        }

        public static string Base64Url(byte[] bytes)
        {
            return System.Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }
    }
}
