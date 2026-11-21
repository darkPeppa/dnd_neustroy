package ru.neustroy.app

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.File
import java.time.Instant
import java.util.Locale
import ru.neustroy.*

class MainActivity : ComponentActivity(), DeviceActions {
    private var importLimit = 5 * 1024 * 1024
    private var importDone: ((MobileFile?) -> Unit)? = null
    private var voiceDone: ((String?) -> Unit)? = null
    private var permissionDone: ((Boolean) -> Unit)? = null
    private val filePicker =
        registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            val callback = importDone
            val limit = importLimit
            importDone = null
            if (uri == null) {
                callback?.invoke(null)
                return@registerForActivityResult
            }
            Thread {
                    try {
                        var name = "import.txt"
                        contentResolver.query(uri, null, null, null, null)?.use { c ->
                            if (c.moveToFirst()) {
                                val col = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                                if (col >= 0) name = c.getString(col)
                            }
                        }
                        val data =
                            contentResolver.openInputStream(uri)?.use { input ->
                                val out = java.io.ByteArrayOutputStream()
                                val buffer = ByteArray(8192)
                                while (true) {
                                    val n = input.read(buffer)
                                    if (n < 0) break
                                    require(out.size() + n <= limit) {
                                        "Файл больше ${limit / (1024 * 1024)} МБ"
                                    }
                                    out.write(buffer, 0, n)
                                }
                                out.toByteArray()
                            } ?: error("Не удалось открыть файл")
                        val mime =
                            contentResolver.getType(uri)
                                ?: when (name.substringAfterLast('.').lowercase()) {
                                    "json" -> "application/json"
                                    "pdf" -> "application/pdf"
                                    "png" -> "image/png"
                                    "jpg",
                                    "jpeg" -> "image/jpeg"
                                    else -> "text/plain"
                                }
                        runOnUiThread { callback?.invoke(MobileFile(name, mime, data)) }
                    } catch (e: Exception) {
                        runOnUiThread {
                            showError(e.message ?: "Ошибка файла")
                            callback?.invoke(null)
                        }
                    }
                }
                .start()
        }
    private val voice =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val done = voiceDone
            voiceDone = null
            done?.invoke(
                if (result.resultCode == RESULT_OK)
                    result.data
                        ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                        ?.firstOrNull()
                else null
            )
        }
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            permissionDone?.invoke(granted)
            permissionDone = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AndroidContext.application = applicationContext
        PDFBoxResourceLoader.init(applicationContext)
        setContent { NeustroyApp(this) }
    }

    private fun showError(message: String) {
        AlertDialog.Builder(this)
            .setTitle("neustroy")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    override fun importFile(maxBytes: Int, done: (MobileFile?) -> Unit) {
        importLimit = maxBytes
        importDone = done
        filePicker.launch("*/*")
    }

    override fun exportPdf(title: String, text: String) {
        try {
            val pdf = android.graphics.pdf.PdfDocument()
            try {
                val paint =
                    android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                        textSize = 11f
                        color = android.graphics.Color.BLACK
                    }
                val lines = mutableListOf<String>()
                (title + "\n\n" + text).take(200000).split('\n').forEach { line ->
                    if (line.isEmpty()) lines.add("")
                    else {
                        var offset = 0
                        while (offset < line.length) {
                            val count =
                                paint
                                    .breakText(line, offset, line.length, true, 507f, null)
                                    .coerceAtLeast(1)
                            lines.add(line.substring(offset, offset + count))
                            offset += count
                        }
                    }
                }
                lines.chunked(48).forEachIndexed { index, pageLines ->
                    val page =
                        pdf.startPage(
                            android.graphics.pdf.PdfDocument.PageInfo.Builder(595, 842, index + 1)
                                .create()
                        )
                    pageLines.forEachIndexed { i, line ->
                        page.canvas.drawText(line, 44f, 48f + i * 15f, paint)
                    }
                    page.canvas.drawText("neustroy · ${index+1}", 44f, 812f, paint)
                    pdf.finishPage(page)
                }
                val output = java.io.ByteArrayOutputStream()
                pdf.writeTo(output)
                exportFile(MobileFile("neustroy.pdf", "application/pdf", output.toByteArray()))
            } finally {
                pdf.close()
            }
        } catch (e: Exception) {
            showError(e.message ?: "Не удалось создать PDF")
        }
    }

    private var music: android.media.MediaPlayer? = null
    private var speaker: android.speech.tts.TextToSpeech? = null

    override fun playAudio(url: String, volume: Float, loop: Boolean) {
        if (Uri.parse(url).scheme !in listOf("https", "http")) return
        stopAudio()
        try {
            music =
                android.media.MediaPlayer().apply {
                    setAudioAttributes(
                        android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_GAME)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build()
                    )
                    setDataSource(url)
                    isLooping = loop
                    setVolume(volume.coerceIn(0f, 1f), volume.coerceIn(0f, 1f))
                    setOnPreparedListener { it.start() }
                    setOnErrorListener { _, _, _ ->
                        showError("Не удалось воспроизвести аудио")
                        stopAudio()
                        true
                    }
                    prepareAsync()
                }
        } catch (e: Exception) {
            stopAudio()
            showError("Не удалось открыть аудио")
        }
    }

    override fun stopAudio() {
        music?.release()
        music = null
    }

    override fun speak(text: String) {
        if (speaker == null) {
            speaker =
                android.speech.tts.TextToSpeech(this) { status ->
                    if (status == android.speech.tts.TextToSpeech.SUCCESS) {
                        speaker?.language = Locale.getDefault()
                        speaker?.speak(
                            text,
                            android.speech.tts.TextToSpeech.QUEUE_FLUSH,
                            null,
                            "npc",
                        )
                    }
                }
        } else speaker?.speak(text, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, "npc")
    }

    override fun onDestroy() {
        stopAudio()
        speaker?.shutdown()
        super.onDestroy()
    }

    override fun exportFile(file: MobileFile) {
        try {
            val root = File(cacheDir, "shared").apply { mkdirs() }
            val safe = file.name.replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").take(120)
            val target = File(root, safe.ifBlank { "neustroy.txt" })
            target.writeBytes(file.bytes)
            val uri = FileProvider.getUriForFile(this, "$packageName.files", target)
            startActivity(
                Intent.createChooser(
                    Intent(Intent.ACTION_SEND)
                        .setType(file.mime)
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                    "Сохранить или отправить",
                )
            )
        } catch (e: Exception) {
            showError(e.message ?: "Не удалось сохранить файл")
        }
    }

    override fun dictate(done: (String?) -> Unit) {
        val intent =
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                .putExtra(RecognizerIntent.EXTRA_PROMPT, "Заметка для журнала")
        try {
            voiceDone = done
            voice.launch(intent)
        } catch (e: ActivityNotFoundException) {
            voiceDone = null
            showError(
                "На устройстве нет распознавания речи. Можно использовать диктовку в клавиатуре."
            )
            done(null)
        }
    }

    override fun openUrl(url: String) {
        val uri = Uri.parse(url)
        if (uri.scheme in listOf("http", "https")) startActivity(Intent(Intent.ACTION_VIEW, uri))
    }

    override fun extractText(file: MobileFile, done: (String?, String?) -> Unit) {
        Thread {
                try {
                    val text =
                        if (file.mime == "application/pdf" || file.name.endsWith(".pdf", true))
                            PDDocument.load(file.bytes).use { document ->
                                require(document.numberOfPages <= 40) {
                                    "Импорт листа: не более 40 страниц"
                                }
                                PDFTextStripper().getText(document) +
                                    "\n" +
                                    (document.documentCatalog.acroForm?.fieldTree?.joinToString(
                                        "\n"
                                    ) {
                                        "${it.fullyQualifiedName}: ${it.valueAsString}"
                                    } ?: "")
                            }
                        else file.bytes.toString(Charsets.UTF_8)
                    runOnUiThread { done(text.take(50000), null) }
                } catch (e: Exception) {
                    runOnUiThread { done(null, e.message ?: "Не удалось прочитать документ") }
                }
            }
            .start()
    }

    override fun remind(id: String, title: String, start: String, done: (String?) -> Unit) {
        fun schedule() {
            try {
                val at = Instant.parse(start).toEpochMilli() - 3600000
                require(at > System.currentTimeMillis()) { "До встречи осталось меньше часа" }
                val intent = Intent(this, ReminderReceiver::class.java).putExtra("title", title)
                val pending =
                    PendingIntent.getBroadcast(
                        this,
                        id.hashCode(),
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    )
                getSystemService(AlarmManager::class.java)
                    .setWindow(AlarmManager.RTC_WAKEUP, at, 600000, pending)
                done(null)
            } catch (e: Exception) {
                done(e.message ?: "Ошибка напоминания")
            }
        }
        if (
            Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        ) {
            permissionDone = { if (it) schedule() else done("Разрешите уведомления в настройках") }
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else schedule()
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                "sessions",
                "Игровые встречи",
                NotificationManager.IMPORTANCE_DEFAULT,
            )
        )
        val launch =
            PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE,
            )
        val notification =
            Notification.Builder(context, "sessions")
                .setSmallIcon(ru.neustroy.app.R.drawable.ic_neustroy)
                .setContentTitle("Через час игра")
                .setContentText(intent.getStringExtra("title"))
                .setContentIntent(launch)
                .setAutoCancel(true)
                .build()
        try {
            manager.notify(intent.getStringExtra("title").hashCode(), notification)
        } catch (_: SecurityException) {}
    }
}
