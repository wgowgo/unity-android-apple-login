package com.company.applelogin

import android.content.Context

internal object PendingResultStore {
    private const val PREFS = "com.company.applelogin.pending"
    private const val KEY = "result"

    fun save(context: Context, json: String) {
        context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, json)
            .apply()
    }

    fun consume(context: Context): String {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val value = prefs.getString(KEY, "") ?: ""
        if (value.isNotEmpty()) prefs.edit().remove(KEY).apply()
        return value
    }
}
