package chat.lumiverse.prototype

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

@InvokeArg
class ConnectionArgs {
    var action: String = "info"
    var server: String? = null
}

@TauriPlugin
class RuntimePlugin(private val activity: Activity) : Plugin(activity) {
    private var runtime: RuntimeHost? = null
    private var webView: WebView? = null
    private var launcherUrl = "http://tauri.localhost/index.html"
    private var entryHistoryIndex = 0
    private var localAttempt = 0
    private var pendingLocal: Invoke? = null
    private var controls: AlertDialog? = null
    private val handler = Handler(Looper.getMainLooper())
    private val preferences get() = activity.getSharedPreferences("lumiverse-connection", Context.MODE_PRIVATE)

    override fun load(webView: WebView) {
        this.webView = webView
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        CookieManager.getInstance().setAcceptCookie(true)
        installControls(webView)
        (activity as? MainActivity)?.let {
            it.notificationBridge = NativeNotificationBridge(it, webView)
            it.notificationNavigation = { openPendingNotification() }
        }
    }

    @Command
    fun connection(invoke: Invoke) {
        val args = invoke.parseArgs(ConnectionArgs::class.java)
        activity.runOnUiThread {
            try {
                val view = webView ?: throw IllegalStateException("The app is closing.")
                // This command is only exposed to the packaged connection page.
                launcherUrl = view.url?.substringBefore('?') ?: launcherUrl
                when (args.action) {
                    "info" -> invoke.resolve(JSObject().apply {
                        put("mode", preferences.getString("mode", null))
                        put("server", preferences.getString("server", null))
                    })
                    "remote" -> {
                        val server = ServerAddress.normalize(args.server)
                        stopLocal()
                        preferences.edit().putString("mode", "remote").putString("server", server).apply()
                        invoke.resolve()
                        navigate(server)
                    }
                    "local" -> startLocal(invoke)
                    else -> invoke.reject("Unknown connection action.")
                }
            } catch (error: Exception) { invoke.reject(error.message ?: "Could not connect.") }
        }
    }

    private fun navigate(url: String) {
        val view = webView ?: return
        val native = activity as? MainActivity
        val local = preferences.getString("mode", null) == "local"
        val origin = NativeNotifications.origin(url)
        // Consume before selecting: a restarted embedded backend has a new port.
        // Selection still clears its obsolete credential; the authenticated page reconciles it.
        val target = origin?.let { selected -> NativeNotifications.consumeTap(activity, activity.intent, selected, local)?.let { selected + it } } ?: url
        native?.notificationBridge?.select(url, local)
        entryHistoryIndex = view.copyBackForwardList().currentIndex + 1
        view.loadUrl(target)
    }

    private fun openPendingNotification() {
        val view = webView ?: return
        val origin = NativeNotifications.origin(view.url) ?: return
        val path = NativeNotifications.consumeTap(activity, activity.intent, origin) ?: return
        view.loadUrl(origin + path)
    }

    private fun startLocal(invoke: Invoke) {
        stopLocal()
        pendingLocal = invoke
        val attempt = localAttempt
        runtime = RuntimeHost(activity, "tauri", object : RuntimeHost.Listener {
            override fun ready(url: String) { activity.runOnUiThread {
                if (attempt != localAttempt) return@runOnUiThread
                preferences.edit().putString("mode", "local").apply()
                pendingLocal?.resolve(); pendingLocal = null
                navigate(url)
            } }
            override fun failed(message: String) { activity.runOnUiThread {
                if (attempt != localAttempt) return@runOnUiThread
                pendingLocal?.reject(message); pendingLocal = null
                // A crash on the runtime page must leave a way to recover.
                if (webView?.url?.startsWith(launcherUrl) == true) {
                    webView?.evaluateJavascript("document.getElementById('status')?.replaceChildren(document.createTextNode(${JSONObject.quote(message)}))", null)
                } else {
                    showConnectionPage()
                    AlertDialog.Builder(activity).setTitle("Local server stopped").setMessage(message)
                        .setPositiveButton("OK", null).show()
                }
            } }
        }).also { it.start() }
    }

    private fun stopLocal() {
        if (NativeNotifications.isLocal(activity)) LocalNotificationTransport.stop()
        localAttempt += 1
        runtime?.stop(); runtime = null
        pendingLocal?.reject("Connection changed."); pendingLocal = null
    }

    private fun showConnectionPage() {
        stopLocal()
        NativeNotifications.clear(activity)
        navigate("$launcherUrl?changeServer=1")
    }

    private fun showControls() {
        if (controls?.isShowing == true || activity.isFinishing) return
        controls = AlertDialog.Builder(activity).setTitle("Lumiverse")
            .setItems(arrayOf("Reload", "Change server", "Close app")) { _, which ->
                when (which) {
                    0 -> webView?.reload()
                    1 -> showConnectionPage()
                    2 -> activity.finish()
                }
            }.setNegativeButton("Cancel", null).show()
    }

    @android.annotation.SuppressLint("ClickableViewAccessibility")
    private fun installControls(view: WebView) {
        // Native controls also work on a failed/offline page. Android Back is
        // the accessible alternative to the optional two-finger gesture.
        val owner = activity as? AppCompatActivity
        owner?.onBackPressedDispatcher?.addCallback(owner,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (view.canGoBack() && view.copyBackForwardList().currentIndex > entryHistoryIndex) view.goBack()
                    else showControls()
                }
            })
        var startX = 0f
        var startY = 0f
        var secondX = 0f
        var secondY = 0f
        val hold = Runnable { showControls() }
        view.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_POINTER_DOWN && event.pointerCount == 2) {
                startX = event.getX(0); startY = event.getY(0)
                secondX = event.getX(1); secondY = event.getY(1)
                handler.removeCallbacks(hold)
                handler.postDelayed(hold, 650)
            } else if (event.pointerCount != 2 || event.actionMasked != MotionEvent.ACTION_MOVE
                || kotlin.math.abs(event.getX(0) - startX) > 18 * activity.resources.displayMetrics.density
                || kotlin.math.abs(event.getY(0) - startY) > 18 * activity.resources.displayMetrics.density
                || kotlin.math.abs(event.getX(1) - secondX) > 18 * activity.resources.displayMetrics.density
                || kotlin.math.abs(event.getY(1) - secondY) > 18 * activity.resources.displayMetrics.density) {
                handler.removeCallbacks(hold)
            }
            false
        }
    }

    override fun onPause() { handler.removeCallbacksAndMessages(null) }

    override fun onDestroy(activity: AppCompatActivity) {
        handler.removeCallbacksAndMessages(null)
        controls?.dismiss()
        stopLocal()
        (activity as? MainActivity)?.let { it.notificationBridge?.destroy(); it.notificationBridge = null; it.notificationNavigation = null }
        webView = null
    }
}
