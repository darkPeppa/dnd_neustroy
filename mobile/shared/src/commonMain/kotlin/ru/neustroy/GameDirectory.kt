package ru.neustroy

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.ktor.http.encodeURLParameter
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

val applicationRoles = linkedMapOf("player" to "Игрок", "observer" to "Наблюдатель")
val listingFormats =
    linkedMapOf("online" to "Онлайн", "offline" to "Очно", "both" to "Онлайн и очно")

fun JsonElement?.asObject(): JsonObject =
    when (this) {
        is JsonObject -> this
        is JsonPrimitive ->
            runCatching { codec.parseToJsonElement(content).jsonObject }.getOrDefault(obj())
        else -> obj()
    }

fun JsonObject.enabled(key: String) = (get(key) as? JsonPrimitive)?.booleanOrNull != false

@Composable
fun GameDirectoryPanel(s: AppState, onOpen: () -> Unit) {
    var city by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var format by remember { mutableStateOf("any") }
    var results by remember { mutableStateOf(emptyList<JsonObject>()) }
    var editing by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("player") }
    var message by remember { mutableStateOf("") }
    var searched by remember { mutableStateOf(false) }
    suspend fun load() {
        results =
            s.repo
                .call(
                    "campaigns/discover?city=${city.encodeURLParameter()}&format=$format&q=${query.encodeURLParameter()}"
                )
                .jsonArray
                .map { it.jsonObject }
        searched = true
    }
    Panel("Открытые игры") {
        Input("Город", city, { city = it.take(100) })
        Choice(
            "Формат",
            format,
            mapOf("any" to "Любой") + listingFormats.filterKeys { it != "both" },
        ) {
            format = it
        }
        Input("Название или тема", query, { query = it.take(150) })
        Action("Найти игры", !s.busy) { s.run { load() } }
        if (searched && results.isEmpty()) Text("Игры по этим параметрам не найдены")
        results.forEach { game ->
            val id = game.text("id")
            Panel(game.text("name")) {
                Text(game.text("description"))
                Text("${listingFormats[game.text("format")]} · ${game.text("city")}")
                if (game.strings("tags").isNotEmpty())
                    Text(game.strings("tags").joinToString(" · "))
                when {
                    game.flag("joined") ->
                        Action("Открыть игру", !s.busy) {
                            s.run {
                                s.refresh()
                                s.campaignId = id
                                onOpen()
                            }
                        }
                    game.text("application") == "pending" -> {
                        Text(
                            "Мастер рассматривает заявку · ${applicationRoles[game.text("requested_role")]}"
                        )
                        Action("Отозвать заявку", !s.busy) {
                            s.run {
                                s.repo.call("campaigns/$id/applications", "DELETE")
                                load()
                            }
                        }
                    }
                    game.text("application") == "declined" -> Text("Заявка отклонена")
                    editing != id ->
                        Action("Подать заявку") {
                            editing = id
                            role = game.strings("accepts").firstOrNull() ?: "player"
                            message = ""
                        }
                }
                if (editing == id) {
                    Choice(
                        "Роль",
                        role,
                        applicationRoles.filterKeys { it in game.strings("accepts") },
                    ) {
                        role = it
                    }
                    Input("Сообщение мастеру", message, { message = it.take(1200) }, true)
                    Action("Отправить заявку", !s.busy) {
                        s.run {
                            s.repo.call(
                                "campaigns/$id/applications",
                                "POST",
                                obj("role" to role, "message" to message),
                            )
                            editing = ""
                            load()
                        }
                    }
                    Action("Отмена") { editing = "" }
                }
            }
        }
    }
}

@Composable
fun IncomingApplicationsPanel(s: AppState, onChange: suspend () -> Unit) {
    val cid = s.campaignId
    var rows by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    suspend fun load() {
        rows = s.repo.call("campaigns/$cid/applications").jsonArray.map { it.jsonObject }
    }
    LaunchedEffect(cid) {
        try {
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Заявки недоступны"
        }
    }
    Panel("Заявки на вступление") {
        Action("Обновить", !s.busy) { s.run { load() } }
        if (rows.isEmpty()) Text("Заявок пока нет")
        rows.forEach { row ->
            Text(
                "${row.text("name")} · ${applicationRoles[row.text("role_id")]}\n${row.text("message")}"
            )
            if (row.text("state") == "pending")
                for ((decision, label) in
                    mapOf("approved" to "Принять", "declined" to "Отклонить")) {
                    Action(label, !s.busy) {
                        s.run {
                            s.repo.call(
                                "campaigns/$cid/applications/${row.text("id")}",
                                "PATCH",
                                obj("decision" to decision),
                            )
                            load()
                            onChange()
                        }
                    }
                }
            else Text(if (row.text("state") == "approved") "Принята" else "Отклонена")
        }
    }
}

private val palettes =
    listOf(
        Triple("#131527", "#9c73df", "stars"),
        Triple("#101c1a", "#5da37e", "triangles"),
        Triple("#25151b", "#ad6872", "rings"),
        Triple("#0d1a2d", "#78a9e8", "stars"),
        Triple("#241e18", "#c5a16a", "triangles"),
    )

fun moodAppearance(input: String): JsonObject {
    val mood = input.lowercase()
    val words =
        listOf(
            "космос|зв[её]зд|магия",
            "лес|болот|растен",
            "ужас|вампир|хоррор",
            "зим|снег|льд",
            "пустын|детектив|город",
        )
    val found = words.indexOfFirst { Regex(it).containsMatchIn(mood) }
    val hash = mood.fold(0u) { h, c -> h * 31u + c.code.toUInt() }
    val (base, accent, pattern) =
        palettes[if (found >= 0) found else (hash % palettes.size.toUInt()).toInt()]
    return obj("prompt" to input, "base" to base, "accent" to accent, "pattern" to pattern)
}

private fun color(hex: String) =
    hex.takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) }
        ?.drop(1)
        ?.toLong(16)
        ?.let { Color(0xff000000 or it) }

@Composable
fun CampaignBackdrop(a: JsonObject, modifier: Modifier = Modifier.fillMaxSize()) {
    val base = color(a.text("base")) ?: return
    val accent = (color(a.text("accent")) ?: return).copy(alpha = .2f)
    Canvas(modifier.background(base)) {
        val step = 28.dp.toPx()
        val columns = (size.width / step).toInt() + 1
        val rows = (size.height / step).toInt() + 1
        when (a.text("pattern")) {
            "stars" ->
                for (x in 0..columns) for (y in 0..rows) drawCircle(
                    accent,
                    1.6.dp.toPx(),
                    Offset(x * step, y * step),
                )
            "rings" ->
                for (i in 1..columns + rows) drawCircle(
                    accent,
                    i * step,
                    Offset(size.width, .0f),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()),
                )
            "triangles" ->
                for (i in -rows..columns + rows) {
                    val x = i * step
                    drawLine(accent, Offset(x, 0f), Offset(x + size.height * .58f, size.height))
                    drawLine(accent, Offset(x, 0f), Offset(x - size.height * .58f, size.height))
                }
        }
    }
}

@Composable
fun PresetControls(s: AppState, config: JsonObject, onChange: (JsonObject) -> Unit) {
    var presets by remember { mutableStateOf(emptyList<JsonObject>()) }
    var selected by remember { mutableStateOf("base-2024") }
    var name by remember { mutableStateOf("") }
    var mood by remember { mutableStateOf(config["appearance"].asObject().text("prompt")) }
    suspend fun load() {
        presets = s.repo.call("campaign-presets").jsonArray.map { it.jsonObject }
    }
    LaunchedEffect(s.repo) {
        try {
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Шаблоны недоступны"
        }
    }
    Panel("Шаблоны настроек") {
        Choice("Шаблон", selected, presets.associate { it.text("id") to it.text("name") }) {
            selected = it
        }
        val chosen = presets.find { it.text("id") == selected }
        Action("Загрузить шаблон в редактор", chosen != null) {
            chosen?.get("config")?.asObject()?.let {
                onChange(it)
                mood = it["appearance"].asObject().text("prompt")
            }
        }
        Input("Имя своего шаблона", name, { name = it.take(100) })
        Action("Сохранить шаблон", !s.busy && name.isNotBlank()) {
            s.run {
                val result =
                    s.repo
                        .call("campaign-presets", "POST", obj("name" to name, "config" to config))
                        .jsonObject
                load()
                selected = result.text("id")
                name = ""
            }
        }
        if (chosen?.flag("owned") == true)
            Action("Убрать шаблон", !s.busy) {
                s.run {
                    s.repo.call("campaign-presets/$selected", "DELETE")
                    load()
                    selected = "base-2024"
                }
            }
    }
    Toggle("Помощник для участников", config.enabled("assistant")) {
        onChange(config.changed("assistant" to it))
    }
    Input("Атмосфера фона", mood, { mood = it.take(160) })
    Action("Сгенерировать фон", mood.isNotBlank()) {
        onChange(config.changed("appearance" to moodAppearance(mood.trim())))
    }
    val appearance = config["appearance"].asObject()
    if (appearance.isNotEmpty()) {
        CampaignBackdrop(appearance, Modifier.fillMaxWidth().height(90.dp))
        Action("Сбросить фон") { onChange(config.changed("appearance" to null)) }
    }
}

fun defaultPresets(): List<JsonObject> {
    val base =
        obj(
            "mode" to "rules",
            "edition" to "srd-2024",
            "enabledModules" to listOf("*"),
            "custom" to obj(),
            "assistant" to true,
            "appearance" to null,
        )
    fun preset(id: String, title: String, config: JsonObject) =
        obj("id" to id, "name" to title, "config" to config)
    return listOf(
        preset("base-2024", "База · SRD 2024", base),
        preset("base-2014", "База · SRD 2014", base.changed("edition" to "srd-2014")),
        preset(
            "investigation",
            "Детектив",
            base.changed(
                "mode" to "custom",
                "enabledModules" to listOf("npc", "quest", "connections", "reminder", "safety"),
                "custom" to
                    obj("description" to "Расследование, улики и связи. Бой по договорённости."),
            ),
        ),
        preset(
            "starter",
            "Первая игра",
            base.changed(
                "mode" to "custom",
                "enabledModules" to listOf("quest", "combat", "inventory", "safety"),
                "custom" to
                    obj(
                        "description" to
                            "Объясняйте правила по ходу игры, давайте готовый выбор действий."
                    ),
            ),
        ),
        preset("sandbox", "Кастом мастера", base.changed("mode" to "custom", "edition" to "custom")),
    )
}
