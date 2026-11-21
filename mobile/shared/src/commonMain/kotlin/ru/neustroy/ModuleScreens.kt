package ru.neustroy

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import kotlin.math.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.jetbrains.compose.resources.decodeToImageBitmap
import ru.neustroy.resources.Res

fun JsonObject.decimal(key: String, default: Double = 0.0) =
    (get(key) as? JsonPrimitive)?.doubleOrNull ?: default

fun fieldOptions(f: JsonArray): Map<String, String> =
    (f.getOrNull(3) as? JsonPrimitive)?.content?.split(',')?.associate {
        val p = it.split(':', limit = 2)
        p[0] to p.getOrElse(1) { p[0] }
    } ?: emptyMap()

@Composable
fun CampaignRulesEditor(s: AppState) {
    val cid = s.campaignId
    var config by
        remember(cid) {
            mutableStateOf(
                obj("mode" to "rules", "edition" to "srd-2024", "enabledModules" to listOf("*"))
            )
        }
    var modules by remember { mutableStateOf(emptyList<JsonObject>()) }
    LaunchedEffect(cid) {
        try {
            config = s.repo.call("campaigns/$cid/rules-config").jsonObject
            modules =
                codec
                    .parseToJsonElement(Res.readBytes("files/tool-modules.json").decodeToString())
                    .jsonArray
                    .map { it.jsonObject }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Ошибка настроек"
        }
    }
    Panel("Правила и инструменты") {
        Choice(
            "Режим",
            config.text("mode"),
            mapOf("rules" to "По правилам редакции", "custom" to "Домашние правила мастера"),
        ) {
            config = config.changed("mode" to it)
        }
        Choice("Редакция", config.text("edition"), editions) {
            config = config.changed("edition" to it)
        }
        Text("Включённые инструменты")
        modules.forEach { module ->
            val id = module.text("id")
            val active =
                if ("*" in config.strings("enabledModules")) modules.map { it.text("id") }
                else config.strings("enabledModules")
            Toggle(module.text("name"), id in active) { v ->
                config = config.changed("enabledModules" to if (v) active + id else active - id)
            }
        }
        if (config.text("mode") == "custom") {
            val custom = config["custom"] as? JsonObject ?: obj()
            Input(
                "Описание домашних правил",
                custom.text("description"),
                { config = config.changed("custom" to custom.changed("description" to it)) },
                true,
            )
            Input(
                "Футов в клетке",
                custom.text("feet", "5"),
                { config = config.changed("custom" to custom.changed("feet" to it)) },
            )
        }
        Action("Сохранить правила игры", s.can("manage_rules") && !s.busy) {
            s.run {
                s.repo.call("campaigns/$cid/rules-config", "PUT", config)
                s.notice = "Правила кампании сохранены"
            }
        }
    }
}

@Composable
fun DataField(f: JsonArray, data: JsonObject, set: (JsonObject) -> Unit) {
    val id = f[0].jsonPrimitive.content
    val label = f[1].jsonPrimitive.content
    val type = f[2].jsonPrimitive.content
    when (type) {
        "hidden" -> Unit
        "boolean" -> Toggle(label, data.flag(id)) { set(data.changed(id to it)) }
        "number" -> NumberInput(label, data.decimal(id)) { set(data.changed(id to it)) }
        "date" -> DateInput(label, data.text(id)) { set(data.changed(id to it)) }
        "select" -> Choice(label, data.text(id), fieldOptions(f)) { set(data.changed(id to it)) }
        else ->
            Input(
                label,
                data.text(id),
                { set(data.changed(id to it)) },
                id in
                    listOf(
                        "description",
                        "notes",
                        "lines",
                        "veils",
                        "scenes",
                        "hook",
                        "connections",
                        "motivation",
                    ),
            )
    }
}

@Composable
fun ModulesScreen(s: AppState) {
    val cid = s.campaignId
    var definitions by remember { mutableStateOf(emptyList<JsonObject>()) }
    var docs by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var chosen by remember { mutableStateOf("inventory") }
    var config by remember(cid) { mutableStateOf(obj()) }
    var editing by remember(cid) { mutableStateOf<JsonObject?>(null) }
    var title by remember { mutableStateOf("") }
    var data by remember { mutableStateOf(obj()) }
    var secret by remember { mutableStateOf("") }
    var visibility by remember { mutableStateOf("shared") }
    var volume by remember { mutableStateOf(.5f) }
    suspend fun load() {
        if (cid.isNotEmpty()) {
            docs = s.repo.call("campaigns/$cid/documents").jsonArray.map { it.jsonObject }
            config = s.repo.call("campaigns/$cid/rules-config").jsonObject
        }
    }
    LaunchedEffect(cid) {
        try {
            definitions =
                codec
                    .parseToJsonElement(Res.readBytes("files/tool-modules.json").decodeToString())
                    .jsonArray
                    .map { it.jsonObject }
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Ошибка инструментов"
        }
    }
    val definition = definitions.find { it.text("id") == chosen }
    fun begin(doc: JsonObject? = null) {
        editing = doc ?: obj()
        title = doc?.text("title") ?: definition?.text("name") ?: ""
        data = doc?.get("data") as? JsonObject ?: obj()
        secret = doc?.text("secret") ?: ""
        visibility = doc?.text("visibility") ?: if (chosen == "npc") "private" else "shared"
    }
    suspend fun save(next: JsonObject = data) {
        val id = editing!!.text("id")
        s.repo.call(
            "campaigns/$cid/documents${if(id.isEmpty())"" else "/$id"}",
            if (id.isEmpty()) "POST" else "PUT",
            obj(
                "kind" to chosen,
                "title" to title,
                "data" to next,
                "secret" to secret,
                "visibility" to visibility,
                "roles" to (editing?.strings("roles") ?: emptyList<String>()),
                "revision" to editing!!.number("revision", 1),
            ),
        )
        editing = null
        load()
    }
    PageColumn {
        Message(s)
        CampaignChoice(s)
        if (cid.isEmpty()) Text("Выберите игру")
        else {
            val enabled = config.strings("enabledModules")
            Choice(
                "Инструмент",
                chosen,
                definitions
                    .filter { "*" in enabled || it.text("id") in enabled }
                    .associate { it.text("id") to it.text("name") },
            ) {
                chosen = it
                editing = null
            }
            if (definition != null && (!definition.flag("gm") || s.can("edit_materials")))
                Action("Создать запись") { begin() }
            if (editing != null && definition != null)
                Panel("${definition.text("name")} · редактор") {
                    Input("Название", title, { title = it })
                    Choice(
                        "Доступ",
                        visibility,
                        mapOf("private" to "Личная запись", "shared" to "Участникам игры"),
                    ) {
                        visibility = it
                    }
                    (definition["fields"] as? JsonArray)?.forEach {
                        DataField(it.jsonArray, data) { next -> data = next }
                    }
                    (definition["rows"] as? JsonArray)?.forEach { spec ->
                        val row = spec.jsonArray
                        val key = row[0].jsonPrimitive.content
                        val label = row[1].jsonPrimitive.content
                        val fields = row[2].jsonArray
                        Text(label, style = MaterialTheme.typography.titleMedium)
                        data.rows(key).forEachIndexed { index, item ->
                            Panel("${index+1}") {
                                fields.forEach { field ->
                                    DataField(field.jsonArray, item) { new ->
                                        data =
                                            data.changed(
                                                key to
                                                    data.rows(key).mapIndexed { i, old ->
                                                        if (i == index) new else old
                                                    }
                                            )
                                    }
                                }
                                TextButton({
                                    data =
                                        data.changed(
                                            key to
                                                data.rows(key).filterIndexed { i, _ -> i != index }
                                        )
                                }) {
                                    Text("Удалить строку")
                                }
                            }
                        }
                        OutlinedButton(
                            onClick = { data = data.changed(key to data.rows(key) + obj()) }
                        ) {
                            Text("Добавить: $label")
                        }
                    }
                    if (s.can("edit_materials"))
                        Input(
                            "Секрет мастера · не показывается игрокам",
                            secret,
                            { secret = it },
                            true,
                        )
                    ModuleResult(s, chosen, data) { data = it }
                    if (chosen == "board")
                        BattleBoard(s, data, s.can("edit_materials")) { data = it }
                    Action("Сохранить", !s.busy) { s.run { save() } }
                    TextButton({ editing = null }) { Text("Отмена") }
                }
            docs
                .filter { it.text("kind") == chosen }
                .forEach { doc ->
                    val d = doc["data"]?.jsonObject ?: obj()
                    Panel(doc.text("title")) {
                        ModuleResult(s, chosen, d) { next ->
                            if (doc.text("user_id") == s.userId || s.can("edit_materials")) {
                                s.run {
                                    val result =
                                        s.repo.call(
                                            "campaigns/$cid/documents/${doc.text("id")}",
                                            "PUT",
                                            doc.changed(
                                                "data" to next,
                                                "secret" to doc.text("secret"),
                                            ),
                                        )
                                    load()
                                }
                            }
                        }
                        if (chosen == "board") BattleBoard(s, d, false) {}
                        if (chosen == "music") {
                            Slider(volume, { volume = it })
                            Action("Включить у меня") {
                                s.actions.playAudio(d.text("url"), volume, d.flag("loop"))
                            }
                            Action("Остановить") { s.actions.stopAudio() }
                        }
                        if (chosen == "npc")
                            Action("Прочитать голосом устройства") {
                                s.actions.speak(
                                    doc.text("title") +
                                        ". " +
                                        d.text("appearance") +
                                        ". " +
                                        d.text("voice")
                                )
                            }
                        if (doc.text("secret").isNotEmpty())
                            Text("Секрет мастера: ${doc.text("secret")}")
                        if (doc.text("user_id") == s.userId || s.can("edit_materials")) {
                            TextButton({ begin(doc) }) { Text("Редактировать") }
                            TextButton({
                                s.run {
                                    s.repo.call(
                                        "campaigns/$cid/documents/${doc.text("id")}",
                                        "DELETE",
                                    )
                                    load()
                                }
                            }) {
                                Text("Удалить")
                            }
                        }
                    }
                }
            if (chosen == "safety")
                Action("СТОП · сделать паузу в игре", !s.busy) {
                    s.run {
                        s.repo.call(
                            "campaigns/$cid/chat",
                            "POST",
                            obj("text" to "СТОП. Нужна пауза. Продолжим после согласия участников."),
                        )
                        s.repo.call(
                            "campaigns/$cid/log",
                            "POST",
                            obj(
                                "kind" to "safety",
                                "text" to "Запрошена пауза в игре",
                                "visibility" to "shared",
                            ),
                        )
                        s.notice = "Сигнал отправлен в общий чат"
                    }
                }
            if (chosen == "npc")
                Action("Создать NPC с помощником", !s.busy) {
                    s.run {
                        val r =
                            s.assistant(
                                "npc",
                                "Придумай персонажа мастера для игры ${s.campaign?.text("name")}",
                            )
                        begin()
                        data = obj("appearance" to r.text("text"))
                    }
                }
        }
    }
}

@Composable
fun ModuleResult(s: AppState, kind: String, d: JsonObject, change: (JsonObject) -> Unit) {
    when (kind) {
        "inventory" -> {
            val weight = d.rows("items").sumOf { it.decimal("qty") * it.decimal("weight") }
            val capacity =
                d.decimal("capacity").takeIf { it > 0 }
                    ?: ((d.decimal("strength", 10.0).takeIf { it > 0 } ?: 10.0) * 15)
            Text(
                "Вес: ${"%.1f".formatPortable(weight)} / ${"%.1f".formatPortable(capacity)} фунтов${if(weight>capacity)" · перегруз" else ""}"
            )
            Text(
                "Стоимость предметов: ${d.rows("items").sumOf{it.decimal("qty")*it.decimal("value")}} · монеты ${d.decimal("coins")}"
            )
            listOf("short" to "Короткий отдых", "long" to "Долгий отдых").forEach { (rest, label) ->
                Action(label) {
                    change(
                        d.changed(
                            "items" to
                                d.rows("items").map {
                                    if (
                                        it.text("rest") == rest ||
                                            rest == "long" && it.text("rest") == "short"
                                    )
                                        it.changed("charges" to it["maxCharges"])
                                    else it
                                }
                        )
                    )
                }
            }
            d.rows("items").forEachIndexed { i, item ->
                if (item.number("maxCharges") > 0)
                    OutlinedButton(
                        onClick = {
                            change(
                                d.changed(
                                    "items" to
                                        d.rows("items").mapIndexed { index, old ->
                                            if (index == i)
                                                old.changed(
                                                    "charges" to
                                                        (old.number("charges") - 1).coerceAtLeast(0)
                                                )
                                            else old
                                        }
                                )
                            )
                        }
                    ) {
                        Text(
                            "${item.text("name")}: ${item.number("charges")}/${item.number("maxCharges")} · использовать"
                        )
                    }
            }
        }
        "expenses",
        "loot" -> {
            val total =
                if (kind == "expenses") d.rows("receipts").sumOf { it.decimal("amount") }
                else
                    d.decimal("coins") +
                        d.rows("items").sumOf { it.decimal("qty") * it.decimal("value") }
            val members = d.number("members", s.campaigns.size).coerceAtLeast(1)
            Text(
                "Всего $total · на $members: ${floor(total*100/members)/100} каждому, остаток ${round((total-floor(total*100/members)/100*members)*100)/100}"
            )
            if (kind == "expenses")
                d.rows("receipts")
                    .groupBy { it.text("payer") }
                    .forEach { (payer, rows) ->
                        Text("$payer внёс ${rows.sumOf{it.decimal("amount")}}")
                    }
        }
        "encounter" -> {
            val count = d.rows("monsters").sumOf { it.number("count").coerceAtLeast(0) }
            val xp =
                d.rows("monsters").sumOf {
                    it.number("count").coerceAtLeast(0) * it.number("xp").coerceAtLeast(0)
                }
            val factor =
                if (count <= 1) 1.0
                else if (count == 2) 1.5
                else if (count <= 6) 2.0
                else if (count <= 10) 2.5 else if (count <= 14) 3.0 else 4.0
            Text("Противников: $count · XP $xp · с множителем 2014: ${xp*factor}")
            if (d.number("budget") > 0)
                Text(
                    "Бюджет ${d.number("budget")}: ${if(xp*factor>d.number("budget"))"превышен" else "в пределах"}"
                )
            Text(
                "Учитывайте размер группы, окружение и способности. Для своей редакции задайте бюджет мастера.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        "combat" -> {
            val participants =
                d.rows("participants").sortedByDescending { it.decimal("initiative") }
            val turn = d.number("turn").coerceIn(0, (participants.size - 1).coerceAtLeast(0))
            val round = d.number("round", 1).coerceAtLeast(1)
            Text("Раунд $round · ход: ${participants.getOrNull(turn)?.text("name")?:"—"}")
            participants.forEach { p ->
                Text(
                    "${p.text("name")}: Иниц. ${p.decimal("initiative")} · ХП ${p.decimal("hp")} · ${p.text("conditions")} ${if(p.number("expiresRound") in 1 until round)"Эффект закончился" else p.text("effect")}"
                )
            }
            if (s.can("edit_materials"))
                Action("Следующий ход", participants.isNotEmpty()) {
                    val next = (turn + 1) % participants.size
                    val nextRound = round + if (next == 0) 1 else 0
                    change(
                        d.changed(
                            "participants" to participants,
                            "turn" to next,
                            "round" to nextRound,
                        )
                    )
                    s.log("Бой: раунд $nextRound, ход ${participants[next].text("name")}")
                }
        }
        "world" -> {
            Text(
                "${d.number("day",1)}.${d.number("month",1)}.${d.number("year",1)} · ${d.text("weather")} · ${d.text("location")}"
            )
            d.rows("events")
                .filter {
                    it.number("month") == d.number("month") && it.number("day") == d.number("day")
                }
                .forEach { Text("${it.text("name")}: ${it.text("description")}") }
            if (s.can("edit_materials")) {
                Action("Следующий день") {
                    val days = d.number("daysPerMonth", 30).coerceAtLeast(1)
                    val months = d.number("monthsPerYear", 12).coerceAtLeast(1)
                    val day = d.number("day", 1) + 1
                    val month = d.number("month", 1) + if (day > days) 1 else 0
                    change(
                        d.changed(
                            "day" to if (day > days) 1 else day,
                            "month" to if (month > months) 1 else month,
                            "year" to d.number("year", 1) + if (month > months) 1 else 0,
                            "travelDays" to d.number("travelDays") + 1,
                        )
                    )
                }
                Action("Случайная погода") {
                    change(
                        d.changed(
                            "weather" to
                                listOf("Ясно", "Облачно", "Дождь", "Туман", "Ветер", "Гроза")[
                                    secureInt(6)]
                        )
                    )
                }
            }
        }
        "reminder",
        "quest" -> {
            val date = d.text(if (kind == "quest") "due" else "date")
            if (date.isNotEmpty())
                Action("Напомнить на устройстве") {
                    runCatching { localDateTime(date, d.text("time", "19:00")) }
                        .onSuccess { start ->
                            s.actions.remind(
                                newId(),
                                d.text("description", "Дела по игре"),
                                start,
                            ) {
                                if (it == null) s.notice = "Напоминание запланировано"
                                else s.error = it
                            }
                        }
                        .onFailure { s.error = it.message ?: "Проверьте дату" }
                }
            Text(d.text("description"))
        }
        "advancement" -> {
            val levels = d.rows("classes")
            val total = levels.sumOf { it.number("level") }
            Text("Уровней: $total · бонус владения ${signed(2+(total.coerceAtLeast(1)-1)/4)}")
            levels.forEach { c ->
                val id = c.text("classId").lowercase()
                val req =
                    when (id) {
                        "barbarian" -> listOf("str")
                        "bard",
                        "sorcerer",
                        "warlock" -> listOf("cha")
                        "cleric",
                        "druid" -> listOf("wis")
                        "monk",
                        "ranger" -> listOf("dex", "wis")
                        "paladin" -> listOf("str", "cha")
                        "rogue" -> listOf("dex")
                        "wizard" -> listOf("int")
                        "fighter" ->
                            if (max(d.number("str"), d.number("dex")) >= 13) emptyList()
                            else listOf("str", "dex")
                        else -> emptyList()
                    }
                Text(
                    "${classes[id]?.name?:id} ${c.number("level")}: ${if(levels.size<=1||req.all{d.number(it)>=13})"требования выполнены" else "нужно 13: ${req.joinToString{statLabels[it]?:it}}"}"
                )
            }
            if (total !in 1..20)
                Text(
                    "По базовым правилам суммарно от 1 до 20 уровней",
                    color = MaterialTheme.colorScheme.error,
                )
            Text(d.text("feats"))
        }
        "connections" -> {
            d.rows("edges").forEach {
                Text("${it.text("from")} — ${it.text("label")} → ${it.text("to")}")
            }
            d.rows("nodes").forEach { Text("${it.text("name")}: ${it.text("description")}") }
        }
        else ->
            d.filterValues { it is JsonPrimitive }
                .forEach { (key, value) -> if (key != "url") Text(value.jsonPrimitive.content) }
    }
}

fun String.formatPortable(value: Double) = ((value * 10).roundToInt() / 10.0).toString()

@Composable
fun BattleBoard(s: AppState, data: JsonObject, editable: Boolean, change: (JsonObject) -> Unit) {
    val columns = data.number("columns", 20).coerceIn(2, 60)
    val rows = data.number("rows", 20).coerceIn(2, 60)
    val tokens = data.rows("tokens")
    var selected by remember { mutableStateOf(0) }
    var fogMode by remember { mutableStateOf(false) }
    var measure by remember { mutableStateOf(false) }
    var from by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    var distance by remember { mutableStateOf("") }
    var image by remember(data.text("mapId")) { mutableStateOf<ByteArray?>(null) }
    LaunchedEffect(data.text("mapId")) {
        if (data.text("mapId").isNotBlank())
            try {
                image = s.repo.download(data.text("mapId")).bytes
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                image = null
            }
    }
    if (editable) {
        Choice(
            "Жетон",
            selected.toString(),
            tokens.mapIndexed { i, t -> i.toString() to t.text("name") }.toMap(),
        ) {
            selected = it.toInt()
        }
        Toggle("Открывать / закрывать клетки", fogMode) { fogMode = it }
    }
    Toggle("Измерить расстояние · два касания", measure) {
        measure = it
        from = null
    }
    if (distance.isNotEmpty()) Text(distance)
    Box(Modifier.fillMaxWidth().aspectRatio(columns.toFloat() / rows)) {
        image?.let {
            val bitmap = remember(it) { runCatching { it.decodeToImageBitmap() }.getOrNull() }
            if (bitmap != null)
                Image(
                    bitmap,
                    "Карта",
                    Modifier.fillMaxSize(),
                    contentScale = androidx.compose.ui.layout.ContentScale.FillBounds,
                )
        }
        Canvas(
            Modifier.fillMaxSize().pointerInput(data, editable, fogMode, measure, selected) {
                detectTapGestures { tap ->
                    val x = (tap.x / size.width * columns).toInt().coerceIn(0, columns - 1)
                    val y = (tap.y / size.height * rows).toInt().coerceIn(0, rows - 1)
                    if (measure) {
                        if (from == null) from = x to y
                        else {
                            distance =
                                "${max(abs(x-from!!.first),abs(y-from!!.second))*data.number("feet",5)} футов"
                            from = null
                        }
                    } else if (editable) {
                        if (fogMode) {
                            val fog =
                                data
                                    .text("fog")
                                    .split(';')
                                    .filter { it.isNotBlank() }
                                    .toMutableSet()
                            val cell = "$x,$y"
                            if (!fog.add(cell)) fog.remove(cell)
                            change(data.changed("fog" to fog.joinToString(";")))
                        } else if (selected in tokens.indices)
                            change(
                                data.changed(
                                    "tokens" to
                                        tokens.mapIndexed { i, t ->
                                            if (i == selected) t.changed("x" to x, "y" to y) else t
                                        }
                                )
                            )
                    }
                }
            }
        ) {
            val cw = size.width / columns
            val ch = size.height / rows
            for (x in 0..columns) drawLine(
                Color.Gray.copy(alpha = .5f),
                Offset(x * cw, 0f),
                Offset(x * cw, size.height),
            )
            for (y in 0..rows) drawLine(
                Color.Gray.copy(alpha = .5f),
                Offset(0f, y * ch),
                Offset(size.width, y * ch),
            )
            val fog = data.text("fog").split(';').filter { it.isNotBlank() }.toSet()
            tokens.forEachIndexed { i, t ->
                if (editable || "${t.number("x")},${t.number("y")}" !in fog)
                    drawCircle(
                        if (i == selected) Gold else Blue,
                        min(cw, ch) * .35f,
                        Offset((t.number("x") + .5f) * cw, (t.number("y") + .5f) * ch),
                    )
            }
            fog.forEach { cell ->
                val p = cell.split(',').mapNotNull { it.toIntOrNull() }
                if (p.size == 2)
                    drawRect(
                        Color.Black.copy(alpha = if (editable) .5f else 1f),
                        Offset(p[0] * cw, p[1] * ch),
                        androidx.compose.ui.geometry.Size(cw, ch),
                    )
            }
        }
    }
    tokens.forEachIndexed { i, t ->
        Text(
            "${i+1}. ${t.text("name")} · ${t.number("x")}, ${t.number("y")}",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
