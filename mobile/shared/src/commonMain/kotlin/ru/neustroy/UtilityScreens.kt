@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    kotlin.io.encoding.ExperimentalEncodingApi::class,
)

package ru.neustroy

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlin.io.encoding.Base64
import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.coroutines.*
import kotlinx.datetime.*
import kotlinx.serialization.json.*
import org.jetbrains.compose.resources.decodeToImageBitmap
import ru.neustroy.resources.Res

@Composable
fun DateInput(label: String, value: String, change: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
        Text("$label: ${value.ifEmpty{"Выбрать дату"}}")
    }
    if (open) {
        val picker =
            rememberDatePickerState(
                initialSelectedDateMillis =
                    runCatching {
                            LocalDate.parse(value)
                                .atStartOfDayIn(TimeZone.UTC)
                                .toEpochMilliseconds()
                        }
                        .getOrNull()
            )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton({
                    picker.selectedDateMillis?.let {
                        change(
                            Instant.fromEpochMilliseconds(it)
                                .toLocalDateTime(TimeZone.UTC)
                                .date
                                .toString()
                        )
                    }
                    open = false
                }) {
                    Text("Выбрать")
                }
            },
            dismissButton = { TextButton({ open = false }) { Text("Отмена") } },
        ) {
            DatePicker(picker)
        }
    }
}

fun localDateTime(date: String, time: String) =
    LocalDateTime.parse("${date}T${time}:00").toInstant(TimeZone.currentSystemDefault()).toString()

fun displayDate(value: String) =
    runCatching {
            Instant.parse(value)
                .toLocalDateTime(TimeZone.currentSystemDefault())
                .toString()
                .replace('T', ' ')
        }
        .getOrDefault(value)

@Composable
fun CalendarScreen(s: AppState) {
    var filter by remember { mutableStateOf("all") }
    var dateFilter by remember { mutableStateOf("") }
    var create by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var date by remember {
        mutableStateOf(
            Clock.System.now().toLocalDateTime(TimeZone.currentSystemDefault()).date.toString()
        )
    }
    var time by remember { mutableStateOf("19:00") }
    var hours by remember { mutableStateOf("4") }
    var public by remember { mutableStateOf(false) }
    var capacity by remember { mutableStateOf("6") }
    var description by remember { mutableStateOf("") }
    PageColumn {
        Message(s)
        CampaignChoice(s)
        Choice(
            "События",
            filter,
            mapOf(
                "all" to "Все доступные",
                "campaign" to "Выбранная игра",
                "public" to "Открытые игры",
            ),
        ) {
            filter = it
        }
        DateInput("Показать день", dateFilter) { dateFilter = it }
        if (dateFilter.isNotEmpty()) TextButton({ dateFilter = "" }) { Text("Показать все даты") }
        Text(
            "Часовой пояс: ${TimeZone.currentSystemDefault().id}",
            style = MaterialTheme.typography.bodySmall,
        )
        if (s.can("manage_sessions") || s.me.flag("isAdmin"))
            Action("Предложить встречу") { create = !create }
        if (create)
            Panel("Новая встреча") {
                Input("Название", title, { title = it })
                DateInput("Дата", date) { date = it }
                Choice(
                    "Начало",
                    time,
                    (0..47).associate {
                        val t = "${(it/2).toString().padStart(2,'0')}:${if(it%2==0)"00" else "30"}"
                        t to t
                    },
                ) {
                    time = it
                }
                Choice("Продолжительность", hours, (2..8).associate { it.toString() to "$it ч" }) {
                    hours = it
                }
                Choice("Мест", capacity, (1..6).associate { it.toString() to it.toString() }) {
                    capacity = it
                }
                Toggle("Открытый набор игроков", public) { public = it }
                Input("Описание", description, { description = it }, true)
                Action("Предложить дату", !s.busy) {
                    s.run {
                        val start = Instant.parse(localDateTime(date, time))
                        s.repo.call(
                            "sessions",
                            "POST",
                            obj(
                                "campaignId" to s.campaignId.ifBlank { null },
                                "title" to title,
                                "start" to start.toString(),
                                "end" to (start + hours.toInt().hoursDuration()).toString(),
                                "public" to public,
                                "capacity" to capacity.toInt(),
                                "description" to description,
                            ),
                        )
                        create = false
                        s.refresh()
                    }
                }
            }
        s.sessions
            .filter {
                (filter != "campaign" || it.text("campaign_id") == s.campaignId) &&
                    (filter != "public" || it.flag("public")) &&
                    (dateFilter.isEmpty() || displayDate(it.text("start")).startsWith(dateFilter))
            }
            .forEach { event ->
                Panel(event.text("title")) {
                    Text("${displayDate(event.text("start"))} — ${displayDate(event.text("end"))}")
                    Text(
                        "${event.text("status")} · ${if(event.flag("public"))"Открытая игра" else "Для кампании"}",
                        color = Gold,
                    )
                    Text(event.text("description"))
                    if (event.text("status") == "proposed")
                        listOf("yes" to "Могу", "maybe" to "Возможно", "no" to "Не могу").forEach {
                            (id, label) ->
                            OutlinedButton(
                                onClick = {
                                    s.run {
                                        s.repo.call(
                                            "sessions/${event.text("id")}/vote",
                                            "POST",
                                            obj("answer" to id),
                                        )
                                        s.refresh()
                                    }
                                },
                                enabled = !s.busy,
                            ) {
                                Text(label)
                            }
                        }
                    event.rows("votes").forEach {
                        Text(
                            "${it.text("name")}: ${it.text("answer")}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    if (event.flag("public") && event.text("status") != "cancelled") {
                        Text(
                            "Участников: ${event.rows("attendees").size}/${event.number("capacity")}"
                        )
                        Action(
                            if (event.rows("attendees").any { it.text("user_id") == s.userId })
                                "Отменить участие"
                            else "Занять место",
                            !s.busy,
                        ) {
                            s.run {
                                s.repo.call(
                                    "sessions/${event.text("id")}/join",
                                    if (
                                        event.rows("attendees").any {
                                            it.text("user_id") == s.userId
                                        }
                                    )
                                        "DELETE"
                                    else "POST",
                                )
                                s.refresh()
                            }
                        }
                    }
                    if (event.text("owner_id") == s.userId && event.text("status") == "proposed")
                        Action("Подтвердить дату", !s.busy) {
                            s.run {
                                s.repo.call("sessions/${event.text("id")}/confirm", "POST")
                                s.refresh()
                            }
                        }
                    if (event.text("owner_id") == s.userId && event.text("status") != "cancelled")
                        TextButton({
                            s.run {
                                s.repo.call("sessions/${event.text("id")}/cancel", "POST")
                                s.refresh()
                            }
                        }) {
                            Text("Отменить встречу")
                        }
                    if (event.text("status") == "confirmed") {
                        Action("Напомнить за час") {
                            s.actions.remind(
                                event.text("id"),
                                event.text("title"),
                                event.text("start"),
                            ) {
                                if (it == null) s.notice = "Напоминание запланировано"
                                else s.error = it
                            }
                        }
                        Action("В календарь телефона · ICS") {
                            s.actions.exportFile(calendarFile(event))
                        }
                    }
                }
            }
    }
}

fun Int.hoursDuration() = kotlin.time.Duration.parse("${this}h")

fun calendarFile(s: JsonObject): MobileFile {
    fun esc(s: String) =
        s.replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")
    fun stamp(v: String) =
        Instant.parse(v)
            .toString()
            .replace("-", "")
            .replace(":", "")
            .replace(Regex("\\.\\d+Z$"), "Z")
    val text =
        listOf(
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//neustroy//RU",
                "BEGIN:VEVENT",
                "UID:${s.text("id")}@neustroy",
                "DTSTAMP:${stamp(now())}",
                "DTSTART:${stamp(s.text("start"))}",
                "DTEND:${stamp(s.text("end"))}",
                "SUMMARY:${esc(s.text("title"))}",
                "BEGIN:VALARM",
                "TRIGGER:-PT1H",
                "ACTION:DISPLAY",
                "DESCRIPTION:Игра через час",
                "END:VALARM",
                "END:VEVENT",
                "END:VCALENDAR",
            )
            .joinToString("\r\n") + "\r\n"
    return MobileFile("session.ics", "text/calendar", text.encodeToByteArray())
}

fun ruleDescription(entry: JsonObject): String {
    if (entry.text("text").isNotEmpty()) return entry.text("text")
    val data = entry["data"] as? JsonObject ?: entry
    return (data.text("desc") +
            "\n" +
            data.rows("features").joinToString("\n\n") { it.text("name") + "\n" + it.text("desc") })
        .ifBlank { data.toString() }
}

@Composable
fun RulesScreen(s: AppState) {
    var edition by remember { mutableStateOf("srd-2024") }
    var kind by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<JsonObject?>(null) }
    var pages by remember(edition) { mutableStateOf(emptyList<JsonObject>()) }
    var full by remember { mutableStateOf(false) }
    LaunchedEffect(edition, full) {
        if (full)
            try {
                pages =
                    codec
                        .parseToJsonElement(Res.readBytes("files/$edition.json").decodeToString())
                        .jsonObject
                        .rows("pages")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                s.error = e.message ?: "Ошибка библиотеки"
            }
    }
    PageColumn {
        Message(s)
        Choice("Редакция", edition, editions.filterKeys { it != "custom" }) {
            edition = it
            selected = null
        }
        Toggle("Полный текст SRD · по страницам", full) {
            full = it
            selected = null
        }
        Input("Поиск по оригиналу на английском", query, { query = it })
        if (!full)
            Choice(
                "Раздел",
                kind,
                mapOf(
                    "" to "Все",
                    "classes" to "Классы",
                    "species" to "Виды",
                    "backgrounds" to "Предыстории",
                    "feats" to "Черты",
                    "spells" to "Заклинания",
                    "weapons" to "Оружие",
                    "armor" to "Доспехи",
                    "items" to "Снаряжение",
                    "magicitems" to "Магические предметы",
                    "creatures" to "Существа",
                ),
            ) {
                kind = it
            }
        if (selected != null)
            Panel(selected!!.text("name", "Страница ${selected!!.number("page")}")) {
                Text(if (full) selected!!.text("text") else ruleDescription(selected!!))
                TextButton({ selected = null }) { Text("Закрыть") }
            }
        if (full)
            pages
                .filter { query.isEmpty() || it.text("text").contains(query, true) }
                .take(100)
                .forEach { p ->
                    OutlinedButton(onClick = { selected = p }, modifier = Modifier.fillMaxWidth()) {
                        Text("Страница ${p.number("page")} · ${p.text("text").trim().take(90)}")
                    }
                }
        else
            s.rules?.search(query, edition, kind)?.forEach { entry ->
                OutlinedButton(onClick = { selected = entry }, modifier = Modifier.fillMaxWidth()) {
                    Text("${entry.text("name")} · ${entry.text("kind")}")
                }
            }
        Text(
            "Wizards of the Coast · SRD 5.1 и 5.2.1 · CC BY 4.0. Данные Open5e. Оригиналы на английском. Показано до 100 совпадений — уточните поиск.",
            style = MaterialTheme.typography.bodySmall,
        )
        TextButton({ s.actions.openUrl("https://www.dndbeyond.com/srd") }) {
            Text("Источники и лицензия")
        }
    }
}

@Composable
fun AssistantScreen(s: AppState) {
    var action by remember { mutableStateOf("rules") }
    var prompt by remember { mutableStateOf("") }
    var result by remember { mutableStateOf("") }
    PageColumn {
        Message(s)
        Panel("Подключение модели") {
            Choice(
                "Провайдер",
                s.provider,
                mapOf(
                    "basic" to "Базовые помощники · без ключа",
                    "server" to "Модель сервера / Ollama",
                    "openai" to "OpenAI API",
                    "groq" to "Groq API",
                    "openrouter" to "OpenRouter API",
                    "deepseek" to "DeepSeek API",
                ),
            ) {
                s.provider = it
            }
            if (s.provider !in listOf("server", "basic"))
                Input(
                    "API-ключ · только до закрытия приложения",
                    s.apiKey,
                    { s.apiKey = it },
                    password = true,
                )
            if (!s.repo.offline) AgentConnectionPanel(s)
            Input("Модель · пусто = стандартная провайдера", s.model, { s.model = it })
            Input("Модель изображений · пусто = стандартная", s.imageModel, { s.imageModel = it })
            Choice(
                "Открытая модель сервера",
                s.model,
                mapOf(
                    "" to "По умолчанию",
                    "qwen3:4b" to "Qwen 3 · 4B",
                    "llama3.2:3b" to "Llama 3.2 · 3B",
                    "gemma3:4b" to "Gemma 3 · 4B",
                ),
            ) {
                s.model = it
            }
            Text(
                "Ключ используется только для выбранного запроса через ваш API-сервер и не записывается в журнал. Подписка на чат и API оплачиваются и подключаются отдельно.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Choice(
            "Помощник",
            action,
            mapOf(
                "rules" to "Консультант по правилам",
                "backstory" to "История персонажа",
                "summary" to "Секретарь игры",
                "npc" to "Персонаж мастера",
                "scenario" to "Подготовка сюжета",
                "contradictions" to "Сверка записей",
            ),
        ) {
            action = it
        }
        if (s.campaigns.isNotEmpty()) CampaignChoice(s)
        Input("Запрос", prompt, { prompt = it }, true)
        Action("Спросить", !s.busy && prompt.isNotBlank()) {
            s.run { result = s.assistant(action, prompt).text("text") }
        }
        if (result.isNotEmpty())
            Panel("Ответ · проверьте перед использованием") {
                Text(result)
                Action("Сохранить в личный журнал", s.campaignId.isNotEmpty() && !s.busy) {
                    s.run {
                        s.repo.call(
                            "campaigns/${s.campaignId}/notes",
                            "POST",
                            obj(
                                "title" to "Помощник · ${now().take(10)}",
                                "body" to result.take(20000),
                                "visibility" to "private",
                                "links" to emptyList<String>(),
                            ),
                        )
                        s.notice = "Сохранено в личном журнале"
                    }
                }
                Action("Экспорт текста") {
                    s.actions.exportFile(
                        MobileFile("assistant.txt", "text/plain", result.encodeToByteArray())
                    )
                }
            }
        if (s.repo.offline)
            Panel("Правила без сети") {
                Text("Библиотека SRD работает без модели и аккаунта.")
                Action("Открыть библиотеку") { s.page = "rules" }
            }
        Panel("Ваш платный агент") {
            Text(
                "Подключите neustroy как MCP-плагин в ChatGPT/Codex или другом совместимом клиенте. Помощь агента доступна в том клиенте с вашей подпиской; права на листы и материалы проверяет API."
            )
            Action("Открыть ChatGPT") { s.actions.openUrl("https://chatgpt.com/") }
        }
    }
}

@Composable
fun PortraitPanel(s: AppState, id: String) {
    var file by remember(id) { mutableStateOf<MobileFile?>(null) }
    var prompt by remember { mutableStateOf("") }
    if (id.isEmpty()) {
        Text("Сохраните персонажа, чтобы добавить портрет.")
        return
    }
    LaunchedEffect(id) {
        try {
            file = s.repo.portrait(id)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {}
    }
    file?.let { image ->
        val bitmap =
            remember(image) { runCatching { image.bytes.decodeToImageBitmap() }.getOrNull() }
        if (bitmap != null)
            Image(
                bitmap,
                contentDescription = "Портрет персонажа",
                modifier = Modifier.fillMaxWidth().heightIn(max = 400.dp),
            )
    }
    Action("Загрузить готовый портрет") {
        s.actions.importFile {
            if (it != null) {
                if (!it.mime.startsWith("image/")) s.error = "Выберите изображение" else file = it
            }
        }
    }
    if (s.agentEnabled) {
        Input("Промпт для портрета", prompt, { prompt = it }, true)
        Action("Сгенерировать у выбранного провайдера", !s.busy && prompt.isNotBlank()) {
            s.run {
                val r = s.assistant("portrait", prompt)
                file =
                    MobileFile(
                        "portrait.png",
                        r.text("mime", "image/png"),
                        Base64.decode(r.text("base64")),
                    )
            }
        }
        Text(
            "Генерация использует API-провайдера из раздела «Помощники». Поддерживается провайдер изображений; запрос может расходовать его платную квоту.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
    if (file != null)
        Action("Сохранить выбранный портрет", !s.busy) {
            s.run {
                s.repo.portrait(id, file)
                s.notice = "Портрет сохранён"
            }
        }
}
