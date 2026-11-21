package ru.neustroy

import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

@Composable
fun TelegramConnection(s: AppState) {
    var status by remember { mutableStateOf(obj()) }
    var url by remember { mutableStateOf("") }
    suspend fun load() {
        status = s.repo.call("telegram").jsonObject
    }
    LaunchedEffect(s.userId) {
        try {
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Ошибка подключения Telegram"
        }
    }
    Panel("Telegram") {
        Text(
            if (status.flag("linked")) "Бот связан с вашим профилем."
            else if (status.flag("enabled")) "Подключите бота к своему профилю."
            else "Администратор ещё не подключил бота."
        )
        if (status.text("username").isNotEmpty()) Text("@${status.text("username")}")
        if (status.flag("enabled"))
            Action("Создать ссылку привязки", !s.busy) {
                s.run { url = s.repo.call("telegram/link", "POST").jsonObject.text("url") }
            }
        if (url.isNotEmpty()) {
            Action("Открыть бота и нажать Start") { s.actions.openUrl(url) }
            Text("Ссылка одноразовая, действует 10 минут.")
        }
        if (status.flag("linked"))
            Action("Отключить Telegram", !s.busy) {
                s.run {
                    s.repo.call("telegram", "DELETE")
                    url = ""
                    load()
                }
            }
        Text(
            "/games — выбрать игру\n/note — личная заметка\n/shared — общая запись\n/dice — кубики\n/sessions — встречи\n/materials — доступные материалы\n/summary — сводка\n/login — одноразовый код входа"
        )
    }
}

@Composable
fun ServiceConnections(s: AppState) {
    var status by remember { mutableStateOf(obj()) }
    var values by remember { mutableStateOf(obj()) }
    suspend fun load() {
        status = s.repo.call("integrations").jsonObject
    }
    LaunchedEffect(s.userId) {
        try {
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Ошибка настройки сервиса"
        }
    }
    Panel("Подключения сервера") {
        Text(
            "Telegram: ${status.flag("telegram")} · Email: ${status.flag("email")} · Модель: ${status.flag("assistant")}"
        )
        Text(
            "Ключи сохраняются зашифрованными на сервере. Они не включаются в APK. Пустые поля сохраняют текущие значения."
        )
        val fields =
            linkedMapOf(
                "TELEGRAM_BOT_TOKEN" to "Токен бота из BotFather",
                "PUBLIC_APP_URL" to "Адрес сайта для писем и ссылок",
                "RESEND_API_KEY" to "Ключ Resend",
                "MAIL_FROM" to "Подтверждённый отправитель email",
                "ASSISTANT_BASE_URL" to "Адрес API модели сервера",
                "ASSISTANT_API_KEY" to "Ключ модели сервера · Ollama без ключа",
                "ASSISTANT_MODEL" to "Модель, например qwen3:4b",
                "INTEGRATION_URL" to "Google Apps Script URL",
                "INTEGRATION_SECRET" to "Секрет Google-интеграции",
                "TELEGRAM_CHAT_ID" to "Chat ID уведомлений мастеру",
                "PUSH_GATEWAY_URL" to "Адрес push-шлюза",
                "PUSH_GATEWAY_SECRET" to "Секрет push-шлюза",
            )
        fields.forEach { (id, label) ->
            Input(
                label,
                values.text(id),
                { values = values.changed(id to it) },
                password = id.contains("KEY") || id.contains("TOKEN") || id.contains("SECRET"),
            )
        }
        if (!status.flag("encryptedStorage"))
            Text("Серверу нужен CONFIG_ENCRYPTION_KEY. Локальный сервер создаёт его автоматически.")
        Action("Сохранить подключения", status.flag("encryptedStorage") && !s.busy) {
            s.run {
                s.repo.call("integrations", "PUT", values)
                values = obj()
                load()
                s.refresh()
                s.notice = "Подключения сохранены"
            }
        }
    }
}

@Composable
fun OwnerSetup(s: AppState) {
    var key by remember { mutableStateOf("") }
    Panel("Первичная настройка сервиса") {
        Text(
            "Владелец сервера может получить права администратора одноразовым ключом из admin-setup.txt в папке данных сервера."
        )
        Input("Ключ настройки", key, { key = it }, password = true)
        Action("Завершить настройку владельца", !s.busy && key.isNotEmpty()) {
            s.run {
                s.repo.call("auth/claim-owner", "POST", obj("setupKey" to key))
                key = ""
                s.refresh()
            }
        }
    }
}
