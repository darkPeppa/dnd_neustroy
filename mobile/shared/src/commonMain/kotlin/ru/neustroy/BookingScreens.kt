package ru.neustroy

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.serialization.json.*

val bookingDefaults =
    obj(
        "format" to "surprise",
        "players" to 4,
        "age" to "adults",
        "hours" to 4,
        "experience" to "surprise",
        "rules" to "surprise",
        "characters" to "surprise",
        "characterDetails" to "",
        "genres" to emptyList<String>(),
        "mood" to "На усмотрение мастера",
        "settings" to emptyList<String>(),
        "extras" to emptyList<String>(),
        "wishes" to "",
        "alternatives" to "",
        "name" to "",
        "channel" to "email",
        "contact" to "",
        "consent" to false,
    )

@Composable
fun BuilderScreen(s: AppState) {
    var data by remember {
        mutableStateOf(
            runCatching {
                    s.store.read("booking-draft")?.let { codec.parseToJsonElement(it).jsonObject }
                }
                .getOrNull() ?: bookingDefaults
        )
    }
    var step by remember { mutableStateOf(0) }
    var date by remember { mutableStateOf("") }
    var time by remember { mutableStateOf("19:00") }
    var booked by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(emptyList<JsonObject>()) }
    val pricing =
        (s.settings["pricing"] as? JsonObject) ?: defaultSettings.getValue("pricing").jsonObject
    fun set(key: String, value: Any?) {
        data = data.changed(key to value)
        s.store.write("booking-draft", data.toString())
    }
    PageColumn {
        Message(s)
        Text("Заявка на игру · шаг ${step+1} из 5", style = MaterialTheme.typography.titleLarge)
        Text(
            "Предварительная стоимость: ${quote(data,pricing)} ₽. Бронь подтверждает мастер.",
            color = Gold,
        )
        if (booked.isNotEmpty())
            Panel("Заявка сохранена") {
                Text("Номер $booked")
                Text(
                    if (s.repo.offline)
                        "Это локальная запись. Для отправки мастеру подключитесь к его серверу."
                    else "Статус и согласованная дата появятся в настройках → заявки."
                )
            }
        when (step) {
            0 -> {
                Choice(
                    "Формат",
                    data.text("format"),
                    mapOf(
                        "online" to "Онлайн",
                        "offline" to "За одним столом",
                        "surprise" to "Просто сделай красиво",
                    ),
                ) {
                    set("format", it)
                }
                Choice(
                    "Игроки",
                    data.number("players").toString(),
                    (1..6).associate { it.toString() to it.toString() },
                ) {
                    set("players", it.toInt())
                }
                Choice(
                    "Возраст",
                    data.text("age"),
                    mapOf(
                        "adults" to "Взрослые",
                        "children" to "Дети",
                        "surprise" to "Обсудим с мастером",
                    ),
                ) {
                    set("age", it)
                }
                Choice(
                    "Продолжительность",
                    data.number("hours").toString(),
                    (2..8).associate { it.toString() to "$it ч" },
                ) {
                    set("hours", it.toInt())
                }
            }
            1 -> {
                DateInput("Предпочтительная дата", date) { date = it }
                Input("Время · ЧЧ:ММ", time, { time = it })
                if (date.isNotEmpty())
                    Action("Проверить занятость мастера", !s.busy) {
                        s.run {
                            val start = localDateTime(date, "00:00")
                            val end =
                                (kotlin.time.Instant.parse(start) + 24.hoursDuration()).toString()
                            busy =
                                s.repo
                                    .call("availability?start=$start&end=$end")
                                    .jsonObject
                                    .rows("busy")
                        }
                    }
                busy.forEach {
                    Text(
                        "Занято: ${displayDate(it.text("start"))} — ${displayDate(it.text("end"))}"
                    )
                }
                Input(
                    "Другие удобные даты и время",
                    data.text("alternatives"),
                    { set("alternatives", it) },
                    true,
                )
                TextButton({
                    date = ""
                    time = "19:00"
                }) {
                    Text("Просто сделай красиво · согласуем дату")
                }
                Choice(
                    "Опыт НРИ",
                    data.text("experience"),
                    mapOf(
                        "none" to "Совсем нет",
                        "little" to "1–3 игры",
                        "medium" to "Средний",
                        "expert" to "Большой",
                        "surprise" to "Расскажу позже",
                    ),
                ) {
                    set("experience", it)
                }
                Choice(
                    "Правила",
                    data.text("rules"),
                    mapOf(
                        "base" to "Базовые",
                        "simple" to "Упрощённые",
                        "very-simple" to "Сильно упрощённые",
                        "surprise" to "Просто сделай красиво",
                    ),
                ) {
                    set("rules", it)
                }
            }
            2 -> {
                Choice(
                    "Листы",
                    data.text("characters"),
                    mapOf(
                        "ready" to "Готовые персонажи",
                        "custom" to "Мастер составит по моим пожеланиям",
                        "self" to "Составим самостоятельно",
                        "surprise" to "Просто сделай красиво",
                    ),
                ) {
                    set("characters", it)
                }
                if (data.text("characters") == "ready")
                    classes
                        .filterKeys { it != "custom" }
                        .forEach { (id, c) ->
                            Toggle(c.name, data.text("characterDetails").split(",").contains(id)) {
                                v ->
                                val list =
                                    data
                                        .text("characterDetails")
                                        .split(",")
                                        .filter { it.isNotBlank() }
                                        .toMutableList()
                                if (v) list.add(id) else list.remove(id)
                                set("characterDetails", list.joinToString(","))
                            }
                        }
                if (data.text("characters") == "self")
                    Action("Открыть листы") { s.page = "characters" }
                Input(
                    "Класс, происхождение и пожелания",
                    data.text("characterDetails"),
                    { set("characterDetails", it) },
                    true,
                )
            }
            3 -> {
                Text("Жанры")
                listOf("Детектив", "Ужасы", "Комедия", "Драма", "Романтика", "Триллер", "Экшен")
                    .forEach { g ->
                        Toggle(g, g in data.strings("genres")) { v ->
                            set(
                                "genres",
                                if (v) data.strings("genres") + g else data.strings("genres") - g,
                            )
                        }
                    }
                Choice(
                    "Атмосфера",
                    data.text("mood"),
                    listOf(
                            "На усмотрение мастера",
                            "Лёгкая",
                            "Серьёзная",
                            "Хаотичная",
                            "Реалистичная",
                        )
                        .associateWith { it },
                ) {
                    set("mood", it)
                }
                Text("Сеттинги")
                listOf(
                        "Классическое фэнтези",
                        "Азиатский",
                        "Славянский",
                        "Вампиры",
                        "Fairycore",
                        "Современность",
                        "Космос",
                        "Пираты",
                    )
                    .forEach { g ->
                        Toggle(g, g in data.strings("settings")) { v ->
                            set(
                                "settings",
                                if (v) data.strings("settings") + g
                                else data.strings("settings") - g,
                            )
                        }
                    }
                TextButton({
                    set("genres", emptyList<String>())
                    set("settings", emptyList<String>())
                    set("mood", "На усмотрение мастера")
                }) {
                    Text("Просто сделай красиво")
                }
                Text("Дополнительно")
                mapOf(
                        "chronicle" to "Иллюстрированная хроника",
                        "video" to "Запись игры",
                        "miniatures" to "Миниатюры",
                    )
                    .forEach { (id, name) ->
                        Toggle(
                            "$name · ${pricing.number(id)} ₽${if(id=="miniatures")" / игрок" else ""}",
                            id in data.strings("extras"),
                        ) { v ->
                            set(
                                "extras",
                                if (v) data.strings("extras") + id else data.strings("extras") - id,
                            )
                        }
                    }
                Input(
                    "Дополнительные пожелания и фэндомы",
                    data.text("wishes"),
                    { set("wishes", it) },
                    true,
                )
            }
            4 -> {
                Input("Ваше имя", data.text("name"), { set("name", it) })
                Choice(
                    "Связаться через",
                    data.text("channel"),
                    mapOf("email" to "Email", "telegram" to "Telegram", "phone" to "Телефон"),
                ) {
                    set("channel", it)
                }
                Input("Контакт", data.text("contact"), { set("contact", it) })
                Text(
                    "${data.number("players")} игроков · ${data.number("hours")} ч · ${data.text("format")}\n${data.strings("genres").joinToString()}\n${data.strings("settings").joinToString()}"
                )
                Toggle(
                    "Согласен с условиями и обработкой данных для этой заявки",
                    data.flag("consent"),
                ) {
                    set("consent", it)
                }
                if (s.settings.text("offer").isNotEmpty()) Text(s.settings.text("offer"))
                Action(
                    "Отправить заявку",
                    !s.busy &&
                        data.flag("consent") &&
                        data.text("name").isNotBlank() &&
                        data.text("contact").length >= 3,
                ) {
                    s.run {
                        val payload =
                            if (date.isBlank()) JsonObject(data.filterKeys { it != "start" })
                            else data.changed("start" to localDateTime(date, time))
                        val r = s.repo.call("bookings", "POST", payload).jsonObject
                        booked = r.text("id")
                        s.store.write("booking-draft", null)
                    }
                }
            }
        }
        Row {
            if (step > 0) TextButton({ step-- }) { Text("Назад") }
            if (step < 4) Button({ step++ }) { Text("Далее") }
        }
    }
}

@Composable
fun SettingsScreen(s: AppState) {
    var tab by remember { mutableStateOf("profile") }
    var name by remember { mutableStateOf(s.store.read("player-name") ?: "Мастер") }
    var bookings by remember { mutableStateOf(emptyList<JsonObject>()) }
    var config by remember(s.settings) { mutableStateOf(s.settings) }
    var outbox by remember { mutableStateOf(emptyList<JsonObject>()) }
    PageColumn {
        Message(s)
        Choice(
            "Раздел",
            tab,
            mapOf(
                "profile" to "Устройство и доступ",
                "bookings" to "Заявки",
                "shop" to "Услуги и магазин",
                "config" to "Настройки сервиса",
                "integrations" to "Подключения",
            ),
        ) {
            tab = it
            if (it == "bookings")
                s.run { bookings = s.repo.call("bookings").jsonArray.map { it.jsonObject } }
        }
        when (tab) {
            "profile" -> {
                Text(
                    "${(s.me["user"] as? JsonObject)?.text("name")} · ${if(s.me.flag("isAdmin"))"Администратор сервиса" else "Игрок"}"
                )
                if (s.repo.offline) {
                    Input("Имя в локальной игре", name, { name = it })
                    Action("Сохранить имя") {
                        s.store.write("player-name", name)
                        s.run { s.refresh() }
                    }
                }
                Action("Другой сервер / аккаунт") {
                    s.repo.close()
                    s.apiKey = ""
                    s.connected = false
                    s.login = false
                    s.error = ""
                }
                Action("Показать источники и лицензии") {
                    s.actions.openUrl("https://www.dndbeyond.com/srd")
                }
                Text(
                    "Для агента: MCP на вашем сервере по адресу /mcp. Email-аккаунт и профиль ChatGPT самостоятельные; данные не объединяются по совпадению почты."
                )
                Action("Экспорт своих листов") {
                    s.actions.exportFile(
                        MobileFile(
                            "characters.json",
                            "application/json",
                            JsonArray(s.characters).toString().encodeToByteArray(),
                        )
                    )
                }
            }
            "bookings" -> {
                if (bookings.isEmpty()) Text("Нет заявок")
                bookings.forEach { b ->
                    val d = b["data"]?.jsonObject ?: obj()
                    Panel("${d.text("name")} · ${b.text("status")}") {
                        Text(
                            "${d.number("players")} игроков · ${d.number("hours")} ч · ${b.number("total")} ₽"
                        )
                        Text(d.text("wishes"))
                        Text(d.text("contact"))
                        if (d.text("start").isNotEmpty()) Text(displayDate(d.text("start")))
                        if (s.me.flag("isAdmin") && b.text("status") == "pending") {
                            var start by remember(b) { mutableStateOf(d.text("start")) }
                            Input(
                                "Согласованная дата · ISO с часовым поясом",
                                start,
                                { start = it },
                            )
                            Action("Сохранить дату", !s.busy) {
                                s.run {
                                    s.repo.call(
                                        "bookings/${b.text("id")}",
                                        "PATCH",
                                        obj("start" to start),
                                    )
                                    bookings =
                                        s.repo.call("bookings").jsonArray.map { it.jsonObject }
                                }
                            }
                            listOf("confirm" to "Подтвердить", "decline" to "Отклонить").forEach {
                                (action, label) ->
                                Action(label, !s.busy) {
                                    s.run {
                                        s.repo.call("bookings/${b.text("id")}/$action", "POST")
                                        bookings =
                                            s.repo.call("bookings").jsonArray.map { it.jsonObject }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "shop" -> {
                Panel("Услуги") {
                    val p = s.settings["pricing"]?.jsonObject ?: obj()
                    p.forEach { (key, v) ->
                        Text(
                            "${mapOf("hour" to "Час игры","extraPlayer" to "Игрок сверх четырёх","offline" to "Выезд мастера","customCharacter" to "Подготовка листа","chronicle" to "Хроника","video" to "Видеозапись","miniatures" to "Миниатюра")[key]?:key}: ${v.jsonPrimitive.content} ₽"
                        )
                    }
                    Action("Собрать заявку") { s.page = "builder" }
                }
                s.settings.rows("products").forEach { product ->
                    Panel(product.text("name")) {
                        Text(product.text("description"))
                        Text("${product.number("price")} ₽")
                        Text(s.settings.text("contact"))
                    }
                }
                Text(s.settings.text("about"))
                Text(s.settings.text("contact"))
                if (s.settings.text("offer").isNotEmpty())
                    Panel("Публичная оферта") { Text(s.settings.text("offer")) }
                if (s.settings.text("agreement").isNotEmpty())
                    Panel("Пользовательское соглашение") { Text(s.settings.text("agreement")) }
            }
            "config" ->
                if (s.me.flag("isAdmin")) {
                    val p = config["pricing"]?.jsonObject ?: obj()
                    Panel("Цены") {
                        p.forEach { (key, value) ->
                            Input(
                                key,
                                value.jsonPrimitive.content,
                                { v ->
                                    v.toIntOrNull()?.let {
                                        config =
                                            config.changed(
                                                "pricing" to
                                                    p.changed(key to it.coerceIn(0, 1000000))
                                            )
                                    }
                                },
                            )
                        }
                    }
                    for ((key, label) in
                        mapOf(
                            "about" to "О мастере",
                            "contact" to "Контакты",
                            "offer" to "Публичная оферта",
                            "agreement" to "Пользовательское соглашение",
                            "timezone" to "Часовой пояс мастера",
                        )) Input(
                        label,
                        config.text(key),
                        { config = config.changed(key to it) },
                        key != "timezone",
                    )
                    Action("Сохранить", !s.busy) {
                        s.run {
                            s.repo.call("settings", "PUT", config)
                            s.refresh()
                        }
                    }
                } else Text("Настройки сервиса доступны администратору.")
            "integrations" -> {
                val integrations = s.me["integrations"] as? JsonObject ?: obj()
                Text(
                    "Telegram: ${integrations.flag("telegram")}\nGoogle: ${integrations.flag("google")}\nPush: ${integrations.flag("push")}"
                )
                Text(
                    "Ключи и почтовый сервис подключаются в настройках серверного окружения. API-ключи моделей задаются в разделе «Помощники»."
                )
                if (s.me.flag("isAdmin")) {
                    Action("Очередь доставки", !s.busy) {
                        s.run { outbox = s.repo.call("outbox").jsonArray.map { it.jsonObject } }
                    }
                    Action("Повторить отправку", !s.busy) {
                        s.run {
                            s.repo.call("outbox", "POST")
                            outbox = s.repo.call("outbox").jsonArray.map { it.jsonObject }
                        }
                    }
                    outbox.forEach {
                        Text(
                            "${it.text("event")} · ${it.text("target")} · ${it.text("status")} ${it.text("error")}"
                        )
                    }
                }
            }
        }
    }
}
