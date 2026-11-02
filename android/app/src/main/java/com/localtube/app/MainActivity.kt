package com.localtube.app

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var fullscreenContainer: FrameLayout
    private lateinit var loadingSpinner: ProgressBar
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        fullscreenContainer = findViewById(R.id.fullscreenContainer)
        loadingSpinner = findViewById(R.id.loadingSpinner)

        setupWebView()
        startPythonBackend()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.allowFileAccess = true
        s.allowContentAccess = true
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.databaseEnabled = true
        s.userAgentString = s.userAgentString + " LocalTubeApp/1.0"
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isHapticFeedbackEnabled = true
        webView.addJavascriptInterface(NativeBridge(), "LTNative")
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false

        webView.webViewClient = object : WebViewClient() {
            // App pages stay inside; anything else (YouTube, MX, Sony links) opens in its own app / browser.
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                if (url.host == "127.0.0.1" || url.host == "localhost") return false
                openExternal(url.toString())
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                loadingSpinner.visibility = View.GONE
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (customView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                fullscreenContainer.addView(
                    view,
                    ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
                fullscreenContainer.visibility = View.VISIBLE
                webView.visibility = View.GONE

                setFullscreenBars(true)
            }

            override fun onHideCustomView() {
                if (customView == null) return
                fullscreenContainer.visibility = View.GONE
                fullscreenContainer.removeView(customView)
                customView = null
                customViewCallback?.onCustomViewHidden()
                webView.visibility = View.VISIBLE

                setFullscreenBars(false)
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            }
        }
    }

    private fun startPythonBackend() {
        if (!Python.isStarted()) {
            Python.start(AndroidPlatform(this))
        }

        thread(isDaemon = true) {
            try {
                val py = Python.getInstance()
                val serverModule = py.getModule("server")
                serverModule.callAttr("main")
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        // Wait until Python local server responds on 127.0.0.1:8765
        thread {
            for (i in 1..80) {
                try {
                    val conn = URL("http://127.0.0.1:8765/").openConnection() as HttpURLConnection
                    conn.connectTimeout = 300
                    conn.readTimeout = 300
                    if (conn.responseCode in 200..399) {
                        break
                    }
                } catch (_: Exception) {}
                Thread.sleep(250)
            }

            runOnUiThread {
                webView.loadUrl("http://127.0.0.1:8765/app")
            }
        }
    }

    private fun setFullscreenBars(on: Boolean) {
        val ctl = WindowInsetsControllerCompat(window, window.decorView)
        if (on) {
            ctl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            ctl.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            ctl.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun openExternal(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {}
    }

    /** Small native helpers the app UI (static/app.js) calls through window.LTNative. */
    inner class NativeBridge {
        @JavascriptInterface
        fun haptic() = runOnUiThread {
            webView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        }

        @JavascriptInterface
        fun keepScreenOn(on: Boolean) = runOnUiThread { webView.keepScreenOn = on }

        @JavascriptInterface
        fun setOrientation(mode: String) = runOnUiThread {
            requestedOrientation = when (mode) {
                "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }

        @JavascriptInterface
        fun setSystemBars(color: String, lightIcons: Boolean) = runOnUiThread {
            try {
                val c = Color.parseColor(color)
                window.statusBarColor = c
                window.navigationBarColor = c
                val ctl = WindowCompat.getInsetsController(window, window.decorView)
                ctl.isAppearanceLightStatusBars = lightIcons
                if (Build.VERSION.SDK_INT >= 26) ctl.isAppearanceLightNavigationBars = lightIcons
            } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun share(title: String, url: String) = runOnUiThread {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, title)
                putExtra(Intent.EXTRA_TEXT, if (title.isBlank()) url else "$title\n$url")
            }
            try { startActivity(Intent.createChooser(send, "Share")) } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun openExternal(url: String) = runOnUiThread { this@MainActivity.openExternal(url) }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (customView != null) {
            webView.webChromeClient?.onHideCustomView()
        } else {
            webView.evaluateJavascript("(function(){ return Boolean(window.handleAppBack && window.handleAppBack()); })()") { handled ->
                val wasHandled = handled == "true" || handled == "\"true\""
                if (!wasHandled) {
                    runOnUiThread {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            @Suppress("DEPRECATION")
                            super.onBackPressed()
                        }
                    }
                }
            }
        }
    }
}
