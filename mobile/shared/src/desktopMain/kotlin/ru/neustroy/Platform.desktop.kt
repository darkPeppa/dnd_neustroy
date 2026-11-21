package ru.neustroy

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.security.SecureRandom

private val random = SecureRandom()

actual fun secureInt(bound: Int) = random.nextInt(bound)

actual fun platformHttpClient() = HttpClient(OkHttp)

actual class DeviceStore : Storage {
    private val root =
        File(
                System.getProperty("neustroy.dataDir")
                    ?: when {
                        System.getProperty("os.name").startsWith("Mac") ->
                            System.getProperty("user.home") +
                                "/Library/Application Support/neustroy"
                        System.getProperty("os.name").startsWith("Windows") ->
                            (System.getenv("LOCALAPPDATA") ?: System.getProperty("user.home")) +
                                "/neustroy"
                        else ->
                            (System.getenv("XDG_DATA_HOME")
                                ?: System.getProperty("user.home") + "/.local/share") + "/neustroy"
                    }
            )
            .apply { mkdirs() }

    private fun file(key: String) =
        File(
            root,
            MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") {
                "%02x".format(it)
            } + ".json",
        )

    actual override fun read(key: String) = file(key).takeIf { it.exists() }?.readText()

    actual override fun write(key: String, value: String?) {
        val f = file(key)
        if (value == null) {
            f.delete()
            return
        }
        val temp = File.createTempFile("write-", ".tmp", root)
        try {
            temp.writeText(value)
            try {
                Files.move(
                    temp.toPath(),
                    f.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (e: java.nio.file.AtomicMoveNotSupportedException) {
                Files.move(temp.toPath(), f.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            temp.delete()
        }
    }
}
