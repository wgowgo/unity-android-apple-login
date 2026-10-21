package com.company.applelogin

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal object SecureTokenStore {
    private const val PREFS = "com.company.applelogin.secure"
    private const val ALIAS = "com.company.applelogin.aes"
    private const val IV_LENGTH = 12
    private const val TAG_LENGTH = 128

    fun save(context: Context, name: String, value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val payload = cipher.iv + encrypted
        prefs(context).edit().putString(name, Base64.encodeToString(payload, Base64.NO_WRAP)).apply()
    }

    fun load(context: Context, name: String): String {
        val encoded = prefs(context).getString(name, null) ?: return ""
        return try {
            val payload = Base64.decode(encoded, Base64.NO_WRAP)
            if (payload.size <= IV_LENGTH) return ""
            val iv = payload.copyOfRange(0, IV_LENGTH)
            val ciphertext = payload.copyOfRange(IV_LENGTH, payload.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_LENGTH, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (_: Throwable) {
            ""
        }
    }

    fun remove(context: Context, name: String) {
        prefs(context).edit().remove(name).apply()
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (keyStore.containsAlias(ALIAS)) keyStore.deleteEntry(ALIAS)
    }

    private fun prefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = keyStore.getKey(ALIAS, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }
}
