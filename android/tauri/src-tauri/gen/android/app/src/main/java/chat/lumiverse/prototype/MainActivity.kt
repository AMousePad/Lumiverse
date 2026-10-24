package chat.lumiverse.prototype

import android.os.Bundle
import android.Manifest
import android.content.Intent
import android.app.AlertDialog
import android.net.Uri
import android.provider.DocumentsContract
import android.widget.TextView
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
  private var exportDirectoryReply: ((Uri?, String?) -> Unit)? = null
  private var exportDirectoryDialog: AlertDialog? = null
  private val exportDirectory = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val reply = exportDirectoryReply
    exportDirectoryReply = null
    val data = result.data
    val uri = data?.data
    if (result.resultCode != RESULT_OK || uri == null) reply?.invoke(null, null)
    else try {
      val flags = data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      check(flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0) { "The selected folder is read-only." }
      contentResolver.takePersistableUriPermission(uri, flags)
      reply?.invoke(uri, null)
    } catch (error: Exception) { reply?.invoke(null, error.message ?: "Android did not grant access to the folder.") }
  }
  fun requestExportDirectory(reason: String, reply: (Uri?, String?) -> Unit) {
    if (exportDirectoryReply != null) { reply(null, "An export folder is already being selected."); return }
    exportDirectoryReply = reply
    exportDirectoryDialog = AlertDialog.Builder(this).setTitle("Choose an export folder")
      .setMessage("Android could not open the automatic export location. Select or create a Lumiverse folder inside Downloads or Documents. Lumiverse will remember it for future exports.\n\nAndroid reported: $reason")
      .setPositiveButton("Choose folder") { _, _ ->
        try {
          exportDirectory.launch(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
            putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Download"))
          })
        } catch (error: Exception) { exportDirectoryReply?.invoke(null, error.message); exportDirectoryReply = null }
      }.setNegativeButton("Cancel") { _, _ -> exportDirectoryReply?.invoke(null, null); exportDirectoryReply = null }
      .setOnCancelListener { exportDirectoryReply?.invoke(null, null); exportDirectoryReply = null }
      .create().also { dialog ->
        dialog.setOnShowListener { dialog.findViewById<TextView>(android.R.id.message)?.setTextIsSelectable(true) }
        dialog.show()
      }
  }
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
  override fun onDestroy() {
    exportDirectoryReply?.invoke(null, "The app is closing."); exportDirectoryReply = null
    exportDirectoryDialog?.dismiss(); exportDirectoryDialog = null
    super.onDestroy()
  }
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
