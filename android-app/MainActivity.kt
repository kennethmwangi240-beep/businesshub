package com.businesshub.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
  // CHANGE THIS to your deployed BusinessHub URL
  private val APP_URL = "https://businesshub-zjx8.onrender.com"

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)
    val web: WebView = findViewById(R.id.webView)
    web.webViewClient = WebViewClient()
    web.webChromeClient = WebChromeClient()
    val s: WebSettings = web.settings
    s.javaScriptEnabled = true
    s.domStorageEnabled = true
    s.databaseEnabled = true
    s.allowFileAccess = false
    s.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
    web.loadUrl(APP_URL)
  }

  override fun onBackPressed() {
    val web: WebView = findViewById(R.id.webView)
    if (web.canGoBack()) web.goBack() else super.onBackPressed()
  }
}
