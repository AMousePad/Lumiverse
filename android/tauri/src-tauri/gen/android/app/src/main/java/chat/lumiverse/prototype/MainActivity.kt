package chat.lumiverse.prototype

import android.os.Bundle
import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  var nativeActive = false
  var notificationBridge: NativeNotificationBridge? = null
  var notificationNavigation: (() -> Unit)? = null
  private var permissionReply: ((Boolean) -> Unit)? = null
  private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    permissionReply?.invoke(granted); permissionReply = null
  }
  fun requestNotificationPermission(reply: (Boolean) -> Unit) {
    if (NativeNotifications.permission(this) == "granted") { reply(true); return }
    if (Build.VERSION.SDK_INT < 33 || permissionReply != null) { reply(false); return }
    permissionReply = reply
    NativeNotifications.markPermissionAsked(this)
    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
  }
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent); setIntent(intent); notificationNavigation?.invoke()
  }
  override fun onResume() { super.onResume(); nativeActive = true; notificationBridge?.resume(); notificationNavigation?.invoke() }
  override fun onPause() { nativeActive = false; notificationBridge?.lifecycle(false); super.onPause() }
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      val bars = insets.getInsets(types)
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      // The native container already clears the bars. Notify the WebView with
      // zero safe areas so CSS cannot add them again; keep IME updates flowing.
      WindowInsetsCompat.Builder(insets)
        .setInsets(types, Insets.NONE)
        .setInsetsIgnoringVisibility(types, Insets.NONE)
        .setDisplayCutout(null)
        .build()
    }
    ViewCompat.requestApplyInsets(content)
  }
}
