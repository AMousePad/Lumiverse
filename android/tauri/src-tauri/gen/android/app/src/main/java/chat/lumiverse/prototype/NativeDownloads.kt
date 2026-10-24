package chat.lumiverse.prototype

import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebView
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Owns exports in shared Downloads; no filesystem permission or file:// access. */
class NativeDownloads(private val activity: Activity, private val view: WebView) {
    private val resolver = activity.contentResolver
    private val worker = Executors.newSingleThreadExecutor()
    private val network = Executors.newFixedThreadPool(2)
    private val handler = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(30, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private val transfers = mutableMapOf<String, Transfer>() // Accessed only on worker.
    @Volatile private var selected: String? = null
    @Volatile private var generation = 0
    @Volatile private var destroyed = false
    private val folder = "${Environment.DIRECTORY_DOWNLOADS}/Lumiverse/"
    private data class Transfer(val uri: Uri, val output: OutputStream, val size: Long,
        var written: Long = 0, var touched: Long = System.nanoTime())

    init {
        // Recover files left pending by a process exit. Completed files are untouched.
        worker.execute {
            runCatching {
                resolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, arrayOf(MediaStore.Downloads._ID),
                    "${MediaStore.MediaColumns.OWNER_PACKAGE_NAME}=? AND ${MediaStore.MediaColumns.RELATIVE_PATH}=? AND ${MediaStore.MediaColumns.IS_PENDING}=1",
                    arrayOf(activity.packageName, folder), null)?.use { rows ->
                    while (rows.moveToNext()) resolver.delete(ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, rows.getLong(0)), null, null)
                }
            }
        }
        view.setDownloadListener { url, userAgent, disposition, mimeType, _ ->
            val origin = selected
            if (origin != null && NativeNotifications.origin(view.url) == origin && NativeNotifications.origin(url) == origin) {
                startUrl(url, URLUtil.guessFileName(url, disposition, mimeType), userAgent, origin)
            } else show("Export failed. This download is not from the selected server.")
        }
        handler.postDelayed(object : Runnable {
            override fun run() {
                if (destroyed) return
                worker.execute {
                    val expired = transfers.filterValues { System.nanoTime() - it.touched > TimeUnit.MINUTES.toNanos(2) }.keys.toList()
                    for (id in expired) discard(id)
                    if (expired.isNotEmpty()) show("Export interrupted. Please try again.")
                }
                handler.postDelayed(this, 60000)
            }
        }, 60000)
    }

    fun select(url: String) {
        val origin = NativeNotifications.origin(url) ?: return
        if (origin == selected) return
        generation += 1
        selected = origin
        client.dispatcher.cancelAll()
        worker.execute { transfers.keys.toList().forEach { discard(it) } }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.removeWebMessageListener(view, "lumiverseDownloads")
        WebViewCompat.addWebMessageListener(view, "lumiverseDownloads", setOf(origin)) { _, message, source, mainFrame, proxy ->
            if (!mainFrame || NativeNotifications.origin(source.toString()) != selected || NativeNotifications.origin(view.url) != selected) return@addWebMessageListener
            val epoch = generation
            try {
                val raw = message.data ?: return@addWebMessageListener
                if (raw.length > 70000) return@addWebMessageListener
                val request = JSONObject(raw)
                val id = request.getString("id")
                if (id.length > 64) return@addWebMessageListener
                val payload = request.optJSONObject("payload") ?: JSONObject()
                fun reply(result: Any?, error: String? = null) {
                    activity.runOnUiThread {
                        if (!destroyed && epoch == generation && NativeNotifications.origin(view.url) == origin)
                            proxy.postMessage(JSONObject().put("id", id).put("result", result ?: JSONObject.NULL).put("error", error ?: JSONObject.NULL).toString())
                    }
                }
                if (request.optString("action") == "url") {
                    val target = payload.getString("url")
                    require(NativeNotifications.origin(target) == origin) { "Download must be from the selected server." }
                    startUrl(target, payload.optString("filename"), view.settings.userAgentString, origin)
                    reply(true)
                } else worker.execute {
                    if (destroyed || epoch != generation) return@execute
                    try { reply(handle(request.getString("action"), payload)) }
                    catch (error: Exception) {
                        Log.w("LumiverseDownloads", "Export ${request.optString("action")} failed (${error.javaClass.simpleName})")
                        payload.optString("transfer").takeIf { it.isNotBlank() }?.let { discard(it) }
                        reply(null, error.message ?: "Could not save export.")
                    }
                }
            } catch (_: Exception) { show("Export failed. Could not read the download request.") }
        }
    }

    private fun create(filename: String, mimeType: String, size: Long): Transfer {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, safeFilename(filename))
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType.substringBefore(';').takeIf { it.contains('/') } ?: "application/octet-stream")
            put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("Could not create export.")
        try {
            val output = resolver.openOutputStream(uri, "w") ?: error("Could not open export.")
            return Transfer(uri, output, size)
        } catch (error: Exception) { resolver.delete(uri, null, null); throw error }
    }

    private fun publish(item: Transfer) {
        item.output.close()
        require(item.size < 0 || item.written == item.size) { "The export was incomplete." }
        check(resolver.update(item.uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null) == 1) { "Could not finish export." }
        val name = resolver.query(item.uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else "export"
        } ?: "export"
        show("Export saved\nDownloads/Lumiverse/$name")
    }

    private fun discard(id: String) {
        transfers.remove(id)?.let { remove(it) }
    }
    private fun remove(item: Transfer) {
        runCatching { item.output.close() }
        runCatching { resolver.delete(item.uri, null, null) }
    }
    private fun handle(action: String, payload: JSONObject): Any {
        when (action) {
            "begin" -> {
                check(transfers.size < 4) { "Please wait for the current exports to finish." }
                val size = payload.getLong("size")
                require(size >= 0) { "Invalid export size." }
                val id = UUID.randomUUID().toString()
                transfers[id] = create(payload.optString("filename"), payload.optString("mimeType"), size)
                show("Saving export to Downloads/Lumiverse…")
                return id
            }
            "chunk" -> {
                val item = transfers[payload.getString("transfer")] ?: error("Export is no longer available.")
                require(payload.getLong("offset") == item.written) { "Export chunks arrived out of order." }
                val encoded = payload.getString("data")
                require(encoded.length <= 65536) { "Export chunk is too large." }
                val bytes = Base64.decode(encoded, Base64.NO_WRAP)
                require(bytes.isNotEmpty() && bytes.size <= 49152 && bytes.size.toLong() <= item.size - item.written) { "Invalid export chunk." }
                item.output.write(bytes)
                item.written += bytes.size
                item.touched = System.nanoTime()
            }
            "finish" -> {
                val id = payload.getString("transfer")
                val item = transfers[id] ?: error("Export is no longer available.")
                publish(item)
                transfers.remove(id)
            }
            "abort" -> {
                discard(payload.optString("transfer"))
                showFailure(payload.optString("message").ifBlank { "The export was interrupted. Please try again." })
            }
            else -> error("Unknown export action.")
        }
        return true
    }

    private fun startUrl(url: String, filename: String, userAgent: String, origin: String) {
        val epoch = generation
        val cookies = CookieManager.getInstance().getCookie(url)
        show("Saving export to Downloads/Lumiverse…")
        network.execute {
            var item: Transfer? = null
            var stage = "download the export"
            try {
                var target = url
                for (redirect in 0..5) {
                    check(!destroyed && epoch == generation) { "Connection changed." }
                    require(NativeNotifications.origin(target) == origin) { "Download redirected outside the selected server." }
                    val request = Request.Builder().url(target).header("User-Agent", userAgent).apply {
                        if (!cookies.isNullOrBlank()) header("Cookie", cookies)
                    }.build()
                    client.newCall(request).execute().use { response ->
                        if (response.code in listOf(301, 302, 303, 307, 308)) {
                            check(redirect < 5) { "Too many download redirects." }
                            target = response.header("Location")?.let { response.request.url.resolve(it)?.toString() } ?: error("Invalid download redirect.")
                        } else {
                            check(response.isSuccessful) { "Download failed (${response.code})." }
                            val body = response.body ?: error("The download was empty.")
                            val name = filename.ifBlank { URLUtil.guessFileName(target, response.header("Content-Disposition"), body.contentType()?.toString()) }
                            stage = "create the file in Downloads/Lumiverse"
                            val output = create(name, body.contentType()?.toString() ?: "application/octet-stream", body.contentLength())
                            item = output
                            stage = "write the export"
                            body.byteStream().use { input ->
                                val buffer = ByteArray(65536)
                                while (true) {
                                    check(!destroyed && epoch == generation) { "Connection changed." }
                                    val count = input.read(buffer)
                                    if (count < 0) break
                                    output.output.write(buffer, 0, count)
                                    output.written += count
                                }
                            }
                            check(!destroyed && epoch == generation) { "Connection changed." }
                            stage = "finish saving the export"
                            publish(output)
                            item = null
                            return@execute
                        }
                    }
                }
            } catch (error: Exception) {
                item?.let { remove(it) }
                Log.w("LumiverseDownloads", "Could not $stage (${error.javaClass.simpleName})")
                if (!destroyed) showFailure("Could not $stage. ${error.message.orEmpty()}")
            }
        }
    }

    private fun showFailure(reason: String) {
        val message = reason.filter { !it.isISOControl() }.trim().take(240)
        show("Export failed. $message")
    }

    private fun show(message: String) { activity.runOnUiThread {
        if (!destroyed && !activity.isFinishing) Toast.makeText(activity, message, Toast.LENGTH_LONG).show()
    } }
    fun destroy() {
        destroyed = true
        generation += 1
        handler.removeCallbacksAndMessages(null)
        client.dispatcher.cancelAll()
        network.shutdown()
        worker.execute { transfers.keys.toList().forEach { discard(it) } }
        worker.shutdown()
        view.setDownloadListener(null)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.removeWebMessageListener(view, "lumiverseDownloads")
    }

    companion object {
        fun safeFilename(suggested: String): String {
            val name = suggested.replace('\\', '/').substringAfterLast('/').filter { !it.isISOControl() }.trim().trim('.')
                .ifBlank { "export" }
            val extension = name.substringAfterLast('.', "").takeIf { it.length in 1..16 }?.let { ".$it" } ?: ""
            var base = if (extension.isEmpty()) name else name.dropLast(extension.length)
            while ((base + extension).toByteArray(Charsets.UTF_8).size > 220) base = base.dropLast(Character.charCount(base.codePointBefore(base.length)))
            return base + extension
        }
    }
}
