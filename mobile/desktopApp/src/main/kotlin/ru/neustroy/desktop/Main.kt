package ru.neustroy.desktop

import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.*
import java.awt.Desktop
import java.awt.SystemTray
import java.awt.TrayIcon
import java.awt.image.BufferedImage
import java.io.File
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sound.sampled.*
import javax.swing.JFileChooser
import javax.swing.JOptionPane
import org.apache.pdfbox.Loader
import org.apache.pdfbox.text.PDFTextStripper
import ru.neustroy.*

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "neustroy · игровой стол",
        state = rememberWindowState(width = 1180.dp, height = 820.dp),
    ) {
        NeustroyApp(rememberActions())
    }
}

@androidx.compose.runtime.Composable
private fun rememberActions() = androidx.compose.runtime.remember { DesktopActions() }

class DesktopActions : DeviceActions {
    override fun exportPdf(title: String, text: String) {
        try {
            org.apache.pdfbox.pdmodel.PDDocument().use { document ->
                val candidates =
                    listOf(
                        "/System/Library/Fonts/Supplemental/Arial.ttf",
                        "C:/Windows/Fonts/arial.ttf",
                        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
                    )
                val file =
                    candidates.map(::File).firstOrNull { it.exists() }
                        ?: error("Для PDF нужен системный Arial, DejaVu Sans или Liberation Sans")
                val font = org.apache.pdfbox.pdmodel.font.PDType0Font.load(document, file)
                val lines = mutableListOf<String>()
                (title + "\n\n" + text).take(200000).split('\n').forEach { line ->
                    var part = ""
                    line.forEach { ch ->
                        val safe = if (ch.code < 32) ' ' else ch
                        val next = part + safe
                        val width =
                            runCatching { font.getStringWidth(next) * 11 / 1000 }.getOrElse { 0f }
                        if (width > 507) {
                            lines.add(part)
                            part = safe.toString()
                        } else part = next
                    }
                    lines.add(part)
                }
                lines.chunked(48).forEach { pageLines ->
                    val page =
                        org.apache.pdfbox.pdmodel.PDPage(
                            org.apache.pdfbox.pdmodel.common.PDRectangle.A4
                        )
                    document.addPage(page)
                    org.apache.pdfbox.pdmodel.PDPageContentStream(document, page).use { stream ->
                        stream.beginText()
                        stream.setFont(font, 11f)
                        stream.newLineAtOffset(44f, 794f)
                        stream.setLeading(15f)
                        pageLines.forEach { line ->
                            val safe = buildString {
                                line.forEach { ch ->
                                    if (runCatching { font.encode(ch.toString()) }.isSuccess)
                                        append(ch)
                                }
                            }
                            stream.showText(safe)
                            stream.newLine()
                        }
                        stream.endText()
                    }
                }
                val out = java.io.ByteArrayOutputStream()
                document.save(out)
                exportFile(MobileFile("neustroy.pdf", "application/pdf", out.toByteArray()))
            }
        } catch (e: Exception) {
            JOptionPane.showMessageDialog(null, e.message)
        }
    }

    private val scheduler =
        Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "neustroy-reminders").apply { isDaemon = true }
        }
    @Volatile private var audioRunning = false
    private var audioLine: SourceDataLine? = null

    override fun openUrl(url: String) {
        if (URI(url).scheme in listOf("https", "http")) Desktop.getDesktop().browse(URI(url))
    }

    override fun exportFile(file: MobileFile) {
        val chooser = JFileChooser().apply { selectedFile = File(file.name) }
        if (chooser.showSaveDialog(null) == JFileChooser.APPROVE_OPTION) {
            val target = chooser.selectedFile
            if (
                !target.exists() ||
                    JOptionPane.showConfirmDialog(
                        null,
                        "Заменить ${target.name}?",
                        "Сохранение",
                        JOptionPane.YES_NO_OPTION,
                    ) == JOptionPane.YES_OPTION
            )
                try {
                    target.writeBytes(file.bytes)
                } catch (e: Exception) {
                    JOptionPane.showMessageDialog(null, e.message)
                }
        }
    }

    override fun importFile(maxBytes: Int, done: (MobileFile?) -> Unit) {
        val chooser = JFileChooser()
        if (chooser.showOpenDialog(null) == JFileChooser.APPROVE_OPTION) {
            val file = chooser.selectedFile
            try {
                require(file.length() <= maxBytes) { "Файл больше ${maxBytes / (1024 * 1024)} МБ" }
                val mime =
                    java.nio.file.Files.probeContentType(file.toPath())
                        ?: when (file.extension.lowercase()) {
                            "json" -> "application/json"
                            "pdf" -> "application/pdf"
                            "png" -> "image/png"
                            "jpg",
                            "jpeg" -> "image/jpeg"
                            else -> "text/plain"
                        }
                done(MobileFile(file.name, mime, file.readBytes()))
            } catch (e: Exception) {
                JOptionPane.showMessageDialog(null, e.message)
                done(null)
            }
        } else done(null)
    }

    override fun extractText(file: MobileFile, done: (String?, String?) -> Unit) {
        try {
            val text =
                if (file.mime == "application/pdf")
                    Loader.loadPDF(file.bytes).use { doc ->
                        require(doc.numberOfPages <= 40) { "Максимум 40 страниц" }
                        PDFTextStripper().getText(doc) +
                            "\n" +
                            (doc.documentCatalog.acroForm?.fieldTree?.joinToString("\n") {
                                "${it.fullyQualifiedName}: ${it.valueAsString}"
                            } ?: "")
                    }
                else file.bytes.decodeToString()
            done(text.take(50000), null)
        } catch (e: Exception) {
            done(null, e.message ?: "Ошибка чтения документа")
        }
    }

    override fun dictate(done: (String?) -> Unit) {
        JOptionPane.showMessageDialog(
            null,
            "Используйте системную диктовку в поле заметки: Win+H в Windows или клавишу диктовки в macOS.",
        )
        done(null)
    }

    override fun remind(id: String, title: String, start: String, done: (String?) -> Unit) {
        val delay =
            java.time.Instant.parse(start).toEpochMilli() - 3600000 - System.currentTimeMillis()
        if (delay <= 0) {
            done("До встречи меньше часа")
            return
        }
        scheduler.schedule(
            {
                javax.swing.SwingUtilities.invokeLater {
                    if (SystemTray.isSupported()) {
                        val icon =
                            TrayIcon(BufferedImage(32, 32, BufferedImage.TYPE_INT_ARGB), "neustroy")
                        try {
                            SystemTray.getSystemTray().add(icon)
                            icon.displayMessage("Через час игра", title, TrayIcon.MessageType.INFO)
                            scheduler.schedule(
                                { SystemTray.getSystemTray().remove(icon) },
                                15,
                                TimeUnit.SECONDS,
                            )
                        } catch (e: Exception) {
                            JOptionPane.showMessageDialog(
                                null,
                                title,
                                "Через час игра",
                                JOptionPane.INFORMATION_MESSAGE,
                            )
                        }
                    } else
                        JOptionPane.showMessageDialog(
                            null,
                            title,
                            "Через час игра",
                            JOptionPane.INFORMATION_MESSAGE,
                        )
                }
            },
            delay,
            TimeUnit.MILLISECONDS,
        )
        done(null)
    }

    override fun playAudio(url: String, volume: Float, loop: Boolean) {
        if (!url.startsWith("https://")) return
        stopAudio()
        audioRunning = true
        Thread {
                try {
                    do {
                        AudioSystem.getAudioInputStream(URI(url).toURL().openStream().buffered())
                            .use { input ->
                                val f = input.format
                                val pcm =
                                    AudioFormat(
                                        AudioFormat.Encoding.PCM_SIGNED,
                                        f.sampleRate,
                                        16,
                                        f.channels,
                                        f.channels * 2,
                                        f.sampleRate,
                                        false,
                                    )
                                AudioSystem.getAudioInputStream(pcm, input).use { decoded ->
                                    val line = AudioSystem.getSourceDataLine(pcm)
                                    audioLine = line
                                    line.open(pcm)
                                    if (line.isControlSupported(FloatControl.Type.MASTER_GAIN)) {
                                        val gain =
                                            line.getControl(FloatControl.Type.MASTER_GAIN)
                                                as FloatControl
                                        gain.value =
                                            (20 * kotlin.math.log10(volume.coerceAtLeast(.001f)))
                                                .coerceIn(gain.minimum, gain.maximum)
                                    }
                                    line.start()
                                    val buffer = ByteArray(8192)
                                    while (audioRunning) {
                                        val n = decoded.read(buffer)
                                        if (n < 0) break
                                        line.write(buffer, 0, n)
                                    }
                                    line.drain()
                                    line.close()
                                }
                            }
                    } while (loop && audioRunning)
                } catch (e: Exception) {
                    javax.swing.SwingUtilities.invokeLater {
                        JOptionPane.showMessageDialog(
                            null,
                            "Не удалось открыть аудио. Поддерживаются форматы системного аудиодекодера, например WAV.",
                        )
                    }
                }
            }
            .apply {
                isDaemon = true
                start()
            }
    }

    override fun stopAudio() {
        audioRunning = false
        audioLine?.stop()
        audioLine?.close()
        audioLine = null
    }
}
