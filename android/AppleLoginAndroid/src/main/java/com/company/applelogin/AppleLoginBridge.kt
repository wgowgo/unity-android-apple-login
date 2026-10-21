package com.company.applelogin

import android.app.Activity
import android.net.Uri

class AppleLoginBridge {
    companion object {
        @JvmField
        var callbackObject: String = "AppleLoginCallback"

        @JvmStatic
        fun start(activity: Activity, authorizationUrl: String, callbackObject: String) {
            this.callbackObject = callbackObject
            AppleAuthLauncher.launch(activity, authorizationUrl)
        }

        @JvmStatic
        fun consumePendingResult(activity: Activity): String {
            return PendingResultStore.consume(activity)
        }

        @JvmStatic
        fun saveSecure(activity: Activity, key: String, value: String) {
            if (value.isEmpty()) {
                SecureTokenStore.remove(activity, key)
                return
            }
            SecureTokenStore.save(activity, key, value)
        }

        @JvmStatic
        fun loadSecure(activity: Activity, key: String): String {
            return SecureTokenStore.load(activity, key)
        }

        @JvmStatic
        fun clearSecure(activity: Activity) {
            SecureTokenStore.clear(activity)
        }

        @JvmStatic
        fun deliverRedirect(activity: Activity, uri: Uri?) {
            val result = parseRedirect(uri)
            val json = result.toJson()
            PendingResultStore.save(activity, json)
            UnityCallbackBridge.send(callbackObject, json)
        }
    }
}
