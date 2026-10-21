package com.company.applelogin

import android.util.Log

object UnityCallbackBridge {
    private const val TAG = "AppleLogin"
    private const val METHOD = "OnNativeResult"

    fun send(gameObject: String?, payload: String) {
        if (gameObject.isNullOrBlank()) return
        try {
            val player = Class.forName("com.unity3d.player.UnityPlayer")
            val method = player.getMethod(
                "UnitySendMessage",
                String::class.java,
                String::class.java,
                String::class.java,
            )
            method.invoke(null, gameObject, METHOD, payload)
        } catch (error: Throwable) {
            Log.i(TAG, "Unity callback is not available yet")
        }
    }
}
