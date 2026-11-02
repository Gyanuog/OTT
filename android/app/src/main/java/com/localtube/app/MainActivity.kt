package com.localtube.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.appcompat.app.AppCompatActivity
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
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false

        webView.webViewClient = object : WebViewClient() {
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

                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )
            }

            override fun onHideCustomView() {
                if (customView == null) return
                fullscreenContainer.visibility = View.GONE
                fullscreenContainer.removeView(customView)
                customView = null
                customViewCallback?.onCustomViewHidden()
                webView.visibility = View.VISIBLE

                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
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
                webView.loadUrl("http://127.0.0.1:8765/")
            }
        }
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
