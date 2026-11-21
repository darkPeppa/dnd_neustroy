package ru.neustroy

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

private val prices =
    linkedMapOf(
        "hour" to "Час игры",
        "extraPlayer" to "Игрок сверх четырёх",
        "offline" to "Выезд",
        "customCharacter" to "Лист от мастера",
        "chronicle" to "Хроника",
        "video" to "Видеозапись",
        "miniatures" to "Миниатюра",
    )
private val formats = mapOf("online" to "Онлайн", "offline" to "Очно")

fun splitTags(value: String) =
    value.split(",").map(String::trim).filter(String::isNotEmpty).take(15)

@Composable
fun MasterFinderPanel(s: AppState, selected: String, onPick: (JsonObject) -> Unit) {
    var items by remember { mutableStateOf(emptyList<JsonObject>()) }
    var city by remember { mutableStateOf("") }
    var genre by remember { mutableStateOf("") }
    var format by remember { mutableStateOf("any") }
    var budget by remember { mutableStateOf(0) }
    var prompt by remember { mutableStateOf("") }
    LaunchedEffect(s.repo) {
        try {
            items = s.repo.call("masters").jsonArray.map { obj("profile" to it) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Каталог недоступен"
        }
    }
    fun search(query: String) {
        s.run {
            items =
                s.repo
                    .call(
                        "masters/match",
                        "POST",
                        obj(
                            "query" to query,
                            "city" to city,
                            "format" to format,
                            "budget" to budget,
                            "tags" to splitTags(genre),
                        ),
                    )
                    .jsonArray
                    .map { it.jsonObject }
        }
    }
    Panel("Подбор ведущего") {
        Choice("Формат", format, mapOf("any" to "Любой") + formats) { format = it }
        Input("Город", city, { city = it.take(100) })
        Input("Жанры через запятую", genre, { genre = it.take(240) })
        NumberInput("Бюджет за час, ₽ · 0 = любой", budget.toDouble(), 0.0, 1000000.0, true) {
            budget = it.toInt()
        }
        Action("Подобрать по анкете", !s.busy) { search("") }
        if (s.agentEnabled) {
            Input("Опишите игру для помощника", prompt, { prompt = it.take(800) }, true)
            Action("Подобрать по описанию", !s.busy && prompt.isNotBlank()) { search(prompt) }
        }
        if (items.isEmpty()) Text("Нет ведущих по этим параметрам")
        items.forEach { row ->
            val p = row.getValue("profile").jsonObject
            val price = p.getValue("pricing").jsonObject
            Panel(p.text("name")) {
                Text(p.text("description"))
                Text(
                    p.strings("formats").map { formats[it] ?: it }.joinToString(" · ") +
                        p.text("city").let { if (it.isBlank()) "" else " · $it" }
                )
                if (row.strings("matched").isNotEmpty())
                    Text("Совпадения · " + row.strings("matched").joinToString())
                prices.forEach { (id, label) -> Text("$label · ${price.number(id)} ₽") }
                p.rows("offers").forEach { offer ->
                    Text(
                        "${offer.text("name")} · ${offer.number("price")} ₽\n${offer.text("description")}"
                    )
                }
                Action(
                    if (selected == p.text("handle")) "Выбран" else "Выбрать",
                    selected != p.text("handle"),
                ) {
                    onPick(p)
                }
            }
        }
    }
}

@Composable
fun MasterOfficePanel(s: AppState) {
    var access by remember { mutableStateOf(obj()) }
    var profile by remember { mutableStateOf<JsonObject?>(null) }
    var tags by remember { mutableStateOf("") }
    suspend fun load() {
        access = s.repo.call("masters/access").jsonObject
        val mine = s.repo.call("masters/mine").jsonObject
        profile =
            if (!mine.flag("enabled")) null
            else
                (mine["profile"] as? JsonObject)
                    ?: obj(
                        "handle" to "",
                        "name" to (s.me["user"] as? JsonObject)?.text("name"),
                        "description" to "",
                        "city" to "",
                        "formats" to listOf("online"),
                        "tags" to emptyList<String>(),
                        "offers" to emptyList<String>(),
                        "visible" to false,
                        "pricing" to defaultSettings.getValue("pricing"),
                    )
        tags = profile?.strings("tags")?.joinToString(", ").orEmpty()
    }
    LaunchedEffect(s.repo) {
        try {
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Кабинет недоступен"
        }
    }
    Panel("Кабинет ведущего") {
        if (!access.flag("enabled")) {
            Text("Доступ ведущего открывает свой прайс, услуги и публикацию игр.")
            if (!access.flag("ready"))
                Text("Для покупки нужен аккаунт email и подключённая оплата на сервере.")
            else {
                val pending = access["pending"] as? JsonObject ?: obj()
                val amount = pending.number("rubles", access.number("rubles"))
                Text("Разовый доступ · $amount ₽")
                if (pending.text("url").isNotEmpty())
                    Action("Открыть страницу оплаты") { s.actions.openUrl(pending.text("url")) }
                else
                    Action("Создать заказ на доступ", !s.busy) {
                        s.run {
                            s.repo.call("masters/access/checkout", "POST", obj("rubles" to amount))
                            load()
                        }
                    }
                if (pending.text("id").isNotEmpty())
                    Action("Проверить оплату", !s.busy) {
                        s.run {
                            val status =
                                s.repo
                                    .call(
                                        "masters/access/verify",
                                        "POST",
                                        obj("id" to pending.text("id")),
                                    )
                                    .jsonObject
                            load()
                            s.refresh()
                            s.notice =
                                when (status.text("state")) {
                                    "paid" -> "Доступ ведущего активирован"
                                    "canceled" -> "Платёж отменён"
                                    else -> "Оплата ещё не подтверждена"
                                }
                        }
                    }
            }
        }
        profile?.let { p ->
            fun set(k: String, v: Any?) {
                profile = p.changed(k to v)
            }
            mapOf(
                    "name" to "Имя",
                    "handle" to "Адрес профиля · латиницей",
                    "city" to "Город",
                    "description" to "Об играх",
                )
                .forEach { (id, label) ->
                    Input(label, p.text(id), { set(id, it) }, id == "description")
                }
            Input("Жанры через запятую", tags, { tags = it })
            formats.forEach { (id, label) ->
                Toggle(label, id in p.strings("formats")) {
                    if (it) set("formats", p.strings("formats") + id)
                    else set("formats", p.strings("formats") - id)
                }
            }
            val pricing = p.getValue("pricing").jsonObject
            Panel("Прайс") {
                prices.forEach { (id, label) ->
                    NumberInput("$label, ₽", pricing.number(id).toDouble(), 0.0, 1000000.0, true) {
                        set("pricing", pricing.changed(id to it.toInt()))
                    }
                }
            }
            Panel("Каталог услуг") {
                val offers = p.rows("offers")
                offers.forEachIndexed { index, offer ->
                    fun edit(k: String, v: Any) {
                        set(
                            "offers",
                            offers.mapIndexed { i, row ->
                                if (i == index) row.changed(k to v) else row
                            },
                        )
                    }
                    Input("Услуга", offer.text("name"), { edit("name", it) })
                    Input("Описание", offer.text("description"), { edit("description", it) })
                    NumberInput("Цена, ₽", offer.number("price").toDouble(), 0.0, 1000000.0, true) {
                        edit("price", it.toInt())
                    }
                    Action("Убрать услугу") {
                        set("offers", offers.filterIndexed { i, _ -> i != index })
                    }
                }
                Action("Добавить услугу", offers.size < 30) {
                    set("offers", offers + obj("name" to "", "description" to "", "price" to 0))
                }
            }
            Toggle("Принимать заявки из каталога", p.flag("visible")) { set("visible", it) }
            Action("Сохранить мой прайс и профиль", !s.busy) {
                s.run {
                    profile =
                        s.repo
                            .call("masters/mine", "PUT", p.changed("tags" to splitTags(tags)))
                            .jsonObject
                    s.notice = "Профиль ведущего сохранён"
                }
            }
        }
    }
}
