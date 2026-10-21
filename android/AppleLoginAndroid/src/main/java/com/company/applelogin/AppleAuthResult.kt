package com.company.applelogin

import org.json.JSONObject

data class AppleAuthResult(
    val status: String,
    val ticket: String? = null,
    val idToken: String? = null,
    val state: String? = null,
    val transactionId: String? = null,
    val code: String? = null,
    val message: String? = null,
) {
    fun toJson(): String {
        val json = JSONObject()
        json.put("status", status)
        if (ticket != null) json.put("ticket", ticket)
        if (idToken != null) json.put("idToken", idToken)
        if (state != null) json.put("state", state)
        if (transactionId != null) json.put("transactionId", transactionId)
        if (code != null) json.put("code", code)
        if (message != null) json.put("message", message)
        return json.toString()
    }

    companion object {
        fun success(ticket: String): AppleAuthResult = AppleAuthResult(status = "success", ticket = ticket)

        fun successIdToken(idToken: String, state: String?): AppleAuthResult =
            AppleAuthResult(status = "success", idToken = idToken, state = state)

        fun cancelled(): AppleAuthResult = AppleAuthResult(status = "cancelled", code = "CANCELLED", message = "Login cancelled")

        fun error(code: String, message: String): AppleAuthResult =
            AppleAuthResult(status = "error", code = code, message = message)
    }
}
