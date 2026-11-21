@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package ru.neustroy

import androidx.compose.ui.window.ComposeUIViewController
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import kotlinx.cinterop.*
import platform.Foundation.NSUserDefaults
import platform.Security.*

fun MainViewController(actions: DeviceActions) = ComposeUIViewController { NeustroyApp(actions) }

actual fun platformHttpClient() = HttpClient(Darwin)

actual class DeviceStore : Storage {
    actual override fun read(key: String) =
        NSUserDefaults.standardUserDefaults.stringForKey("neustroy-$key")

    actual override fun write(key: String, value: String?) {
        if (value == null) NSUserDefaults.standardUserDefaults.removeObjectForKey("neustroy-$key")
        else NSUserDefaults.standardUserDefaults.setObject(value, forKey = "neustroy-$key")
    }
}

actual fun secureInt(bound: Int): Int {
    require(bound > 0)
    val bytes = ByteArray(4)
    val limit = 0x100000000uL - 0x100000000uL % bound.toULong()
    while (true) {
        bytes.usePinned {
            check(
                SecRandomCopyBytes(kSecRandomDefault, 4.convert(), it.addressOf(0)) == errSecSuccess
            ) {
                "Random source unavailable"
            }
        }
        var n = 0uL
        for (b in bytes) n = (n shl 8) or (b.toInt() and 255).toULong()
        if (n < limit) return (n % bound.toULong()).toInt()
    }
}
