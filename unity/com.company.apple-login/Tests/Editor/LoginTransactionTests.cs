using NUnit.Framework;

namespace AppleLoginSDK.Tests
{
    public sealed class LoginTransactionTests
    {
        [Test]
        public void ChallengeMatchesBackendVector()
        {
            LoginTransaction loginTransaction = LoginTransaction.FromVerifier(AppleLoginConstants.VerifierVector);
            Assert.AreEqual(AppleLoginConstants.ChallengeVector, loginTransaction.Challenge);
        }

        [Test]
        public void CreateUsesUnpaddedBase64Url()
        {
            LoginTransaction loginTransaction = LoginTransaction.Create();
            StringAssert.DoesNotContain("+", loginTransaction.Verifier);
            StringAssert.DoesNotContain("/", loginTransaction.Verifier);
            StringAssert.DoesNotContain("=", loginTransaction.Verifier);
            Assert.AreEqual(43, loginTransaction.Challenge.Length);
        }
    }
}
