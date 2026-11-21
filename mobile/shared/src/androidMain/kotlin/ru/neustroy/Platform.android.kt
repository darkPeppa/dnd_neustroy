package ru.neustroy

import android.content.Context
import android.util.AtomicFile
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom

object AndroidContext {
    lateinit var application: Context
}

private val random = SecureRandom()

actual fun secureInt(bound: Int): Int = random.nextInt(bound)

actual fun platformHttpClient() = HttpClient(OkHttp)

actual class DeviceStore : Storage {
    private val root = File(AndroidContext.application.filesDir, "neustroy").apply { mkdirs() }

    private fun file(key: String) =
        AtomicFile(
            File(
                root,
                MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") {
                    "%02x".format(it)
                } + ".json",
            )
        )

    actual override fun read(key: String): String? {
        val f = file(key)
        return if (f.baseFile.exists()) f.openRead().bufferedReader().use { it.readText() }
        else null
    }

    actual override fun write(key: String, value: String?) {
        val f = file(key)
        if (value == null) {
            f.delete()
            return
        }
        val output = f.startWrite()
        try {
            output.write(value.toByteArray())
            f.finishWrite(output)
        } catch (e: Exception) {
            f.failWrite(output)
            throw e
        }
    }
}
