package com.company.applelogin

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

class AppleAuthCallbackActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AppleLoginBridge.deliverRedirect(this, intent?.data)
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            startActivity(launch)
        }
        finish()
    }
}

internal fun parseRedirect(uri: Uri?): AppleAuthResult {
    if (uri == null) return AppleAuthResult.error("REDIRECT_MISSING", "Missing redirect")
    val error = uri.getQueryParameter("error")
    if (!error.isNullOrBlank()) {
        if (error == "user_cancelled" || error == "access_denied" || error == "cancelled") {
            return AppleAuthResult.cancelled()
        }
        return AppleAuthResult.error("PROVIDER_ERROR", "Authentication failed")
    }
    val idToken = uri.getQueryParameter("id_token")
    if (!idToken.isNullOrBlank()) return AppleAuthResult.successIdToken(idToken, uri.getQueryParameter("state"))
    val ticket = uri.getQueryParameter("ticket")
    if (ticket.isNullOrBlank()) return AppleAuthResult.error("TICKET_MISSING", "Missing login ticket")
    return AppleAuthResult.success(ticket)
}
