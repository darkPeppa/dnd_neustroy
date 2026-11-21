package ru.neustroy

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.ktor.http.encodeURLParameter
import kotlinx.serialization.json.*

@Composable
fun CampaignUtilityScreen(s: AppState) {
    var tab by remember { mutableStateOf("search") }
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf(emptyList<JsonObject>()) }
    var times by remember(s.campaignId) { mutableStateOf(obj()) }
    var start by remember { mutableStateOf("") }
    var end by remember { mutableStateOf("") }
    var zone by remember { mutableStateOf(kotlinx.datetime.TimeZone.currentSystemDefault().id) }
    var link by remember { mutableStateOf(obj()) }
    var links by remember { mutableStateOf(emptyList<JsonObject>()) }
    var hours by remember { mutableStateOf("24") }
    var role by remember { mutableStateOf("observer") }
    var preview by remember { mutableStateOf<JsonObject?>(null) }
    var startTime by remember { mutableStateOf("18:00") }
    var endTime by remember { mutableStateOf("21:00") }
    val cid = s.campaignId
    suspend fun loadTimes() {
        times = s.repo.call("campaigns/$cid/time-slots").jsonObject
    }
    suspend fun loadLinks() {
        links = s.repo.call("campaigns/$cid/guest-links").jsonArray.map { it.jsonObject }
    }
    PageColumn {
        Message(s)
        CampaignChoice(s)
        if (cid.isEmpty()) {
            Text("Создайте или выберите игру")
            return@PageColumn
        }
        Choice(
            "Инструмент",
            tab,
            linkedMapOf(
                "search" to "Поиск по кампании",
                "time" to "Общее время",
                "invite" to "Временные гости",
                "backup" to "Копии, заготовки и PDF",
            ),
        ) {
            tab = it
            if (it == "time") s.run { loadTimes() }
            if (it == "invite" && s.can("manage_members") && !s.repo.offline) s.run { loadLinks() }
        }
        when (tab) {
            "search" ->
                Panel("Поиск с учётом доступа") {
                    Input("Слова в материалах, заметках и журнале", query, { query = it })
                    Action("Найти", !s.busy && query.trim().length >= 2) {
                        s.run {
                            found =
                                s.repo
                                    .call("campaigns/$cid/search?q=${query.encodeURLParameter()}")
                                    .jsonArray
                                    .map { it.jsonObject }
                        }
                    }
                    found.forEach { row ->
                        Panel(row.text("title")) {
                            Text(row.text("kind"))
                            Text(row.text("snippet"))
                        }
                    }
                }
            "time" ->
                Panel("Свободное время партии") {
                    Text(
                        "Укажите даты в часовом поясе устройства. Пересечения рассчитываются для всех участников, добавивших окна, минимум на 2 часа."
                    )
                    Input("Подпись часового пояса", zone, { zone = it })
                    DateInput("Свободен с", start) { start = it }
                    DateInput("До", end) { end = it }
                    Input("Время начала · ЧЧ:ММ", startTime, { startTime = it })
                    Input("Время конца · ЧЧ:ММ", endTime, { endTime = it })
                    Action("Добавить окно", !s.busy && start.isNotEmpty() && end.isNotEmpty()) {
                        s.run {
                            s.repo.call(
                                "campaigns/$cid/time-slots",
                                "POST",
                                obj(
                                    "start" to localDateTime(start, startTime),
                                    "end" to localDateTime(end, endTime),
                                    "timezone" to zone,
                                ),
                            )
                            loadTimes()
                        }
                    }
                    Text("Общие окна")
                    times.rows("common").forEach {
                        Text("${displayDate(it.text("start"))} — ${displayDate(it.text("end"))}")
                    }
                    if (times.rows("common").isEmpty())
                        Text("Общих окон пока нет. Участники без ответа ещё не входят в расчёт.")
                    times.rows("slots").forEach { t ->
                        Panel(t.text("name")) {
                            Text(
                                "${displayDate(t.text("start"))} — ${displayDate(t.text("end"))} · ${t.text("timezone")}"
                            )
                            if (t.text("user_id") == s.userId)
                                Action("Удалить окно") {
                                    s.run {
                                        s.repo.call(
                                            "campaigns/$cid/time-slots/${t.text("id")}",
                                            "DELETE",
                                        )
                                        loadTimes()
                                    }
                                }
                        }
                    }
                }
            "invite" ->
                Panel("Гостевой доступ") {
                    Text(
                        "Временный вход без регистрации. После окончания срока или отзыва ссылки доступ прекращается."
                    )
                    if (s.repo.offline) Text("Приглашения доступны на сервере кампании.")
                    else if (s.can("manage_members")) {
                        Input("Часов действия · 1–168", hours, { hours = it })
                        Choice(
                            "Роль",
                            role,
                            mapOf("observer" to "Наблюдатель", "player" to "Игрок"),
                        ) {
                            role = it
                        }
                        Action("Создать приглашение", !s.busy) {
                            s.run {
                                link =
                                    s.repo
                                        .call(
                                            "campaigns/$cid/guest-links",
                                            "POST",
                                            obj(
                                                "hours" to (hours.toIntOrNull() ?: 24),
                                                "role" to role,
                                                "maxUses" to 6,
                                            ),
                                        )
                                        .jsonObject
                                loadLinks()
                            }
                        }
                        if (link.text("code").isNotEmpty()) {
                            val qr = link["qr"] as? JsonObject ?: obj()
                            val size = qr.number("size")
                            val cells = qr["data"] as? JsonArray ?: JsonArray(emptyList())
                            Canvas(Modifier.size(240.dp).background(Color.White)) {
                                if (size > 0) {
                                    val cell = this.size.width / (size + 8)
                                    cells.forEachIndexed { i, v ->
                                        if (v.jsonPrimitive.int == 1)
                                            drawRect(
                                                Color.Black,
                                                Offset(
                                                    (i % size + 4) * cell,
                                                    (i / size + 4) * cell,
                                                ),
                                                Size(cell + .1f, cell + .1f),
                                            )
                                    }
                                }
                            }
                            Text(link.text("url"))
                            Text("Код для приложения: ${link.text("code")}")
                        }
                        links.forEach { l ->
                            Text(
                                "${l.text("role_id")} · ${displayDate(l.text("expires"))} · ${l.number("uses")}/${l.number("max_uses")}"
                            )
                            Action("Отозвать ссылку и доступ её гостей") {
                                s.run {
                                    s.repo.call(
                                        "campaigns/$cid/guest-links/${l.text("hash")}",
                                        "DELETE",
                                    )
                                    loadLinks()
                                }
                            }
                        }
                    } else Text("Приглашения создаёт мастер.")
                }
            else ->
                Panel("Копии и заготовки") {
                    Text(
                        "Копия включает доступные владельцу материалы с вложениями до 25 МБ, общие и его личные записи. Чужие личные записи и чаты не выгружаются. Восстановление создаёт отдельную игру; встречи требуют нового подтверждения."
                    )
                    if (s.campaign?.text("owner_id") == s.userId) {
                        Action("Скачать копию игры", !s.busy) {
                            s.run {
                                val data = s.repo.call("campaigns/$cid/backup")
                                s.actions.exportFile(
                                    MobileFile(
                                        "neustroy-campaign.json",
                                        "application/json",
                                        data.toString().encodeToByteArray(),
                                    )
                                )
                            }
                        }
                        Action("Экспортировать заготовку", !s.busy) {
                            s.run {
                                val data = s.repo.call("campaigns/$cid/backup").jsonObject
                                val template =
                                    data.changed(
                                        "log" to emptyList<String>(),
                                        "sessions" to emptyList<String>(),
                                        "notes" to
                                            data.rows("notes").filter {
                                                it.text("visibility") == "shared"
                                            },
                                    )
                                s.actions.exportFile(
                                    MobileFile(
                                        "neustroy-template.json",
                                        "application/json",
                                        template.toString().encodeToByteArray(),
                                    )
                                )
                            }
                        }
                    }
                    Action("Выбрать копию или заготовку JSON", !s.busy) {
                        s.actions.importFile(40 * 1024 * 1024) { file ->
                            if (file != null)
                                s.run {
                                    val data =
                                        codec
                                            .parseToJsonElement(file.bytes.decodeToString())
                                            .jsonObject
                                    require(data.text("format") == "neustroy-campaign") {
                                        "Это не копия neustroy"
                                    }
                                    preview = data
                                }
                        }
                    }
                    preview?.let { data ->
                        Panel((data["campaign"] as? JsonObject)?.text("name") ?: "Копия") {
                            Text(
                                "Материалов: ${data.rows("clues").size} · заметок: ${data.rows("notes").size} · инструментов: ${data.rows("documents").size}"
                            )
                            Action("Создать отдельную игру из копии", !s.busy) {
                                s.run {
                                    val r =
                                        s.repo.call("campaigns/restore", "POST", data).jsonObject
                                    preview = null
                                    s.refresh()
                                    s.campaignId = r.text("id")
                                    s.notice = "Кампания восстановлена"
                                }
                            }
                            Action("Отмена") { preview = null }
                        }
                    }
                    Action("Экспорт журнала и материалов в PDF", !s.busy) {
                        s.run {
                            val notes =
                                s.repo.call("campaigns/$cid/notes").jsonArray.map { it.jsonObject }
                            val log =
                                s.repo.call("campaigns/$cid/log").jsonArray.map { it.jsonObject }
                            val clues =
                                s.repo.call("clues?campaign=$cid").jsonArray.map { it.jsonObject }
                            s.actions.exportPdf(
                                s.campaign?.text("name") ?: "Журнал",
                                (notes + clues + log).joinToString("\n\n") {
                                    "${it.text("title",it.text("kind"))}\n${it.text("body",it.text("text"))}"
                                },
                            )
                        }
                    }
                }
        }
    }
}
