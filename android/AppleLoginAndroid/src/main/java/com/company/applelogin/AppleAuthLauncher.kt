package com.company.applelogin

import android.app.Activity
import android.net.Uri
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent

internal object AppleAuthLauncher {
    private val browserPackages = listOf(
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.google.android.apps.chrome",
    )

    fun launch(activity: Activity, authorizationUrl: String) {
        val uri = Uri.parse(authorizationUrl)
        val customTabs = CustomTabsIntent.Builder().setShowTitle(true).build()
        val packageName = CustomTabsClient.getPackageName(activity, browserPackages, true)
        if (packageName != null) customTabs.intent.setPackage(packageName)
        customTabs.launchUrl(activity, uri)
    }
}
