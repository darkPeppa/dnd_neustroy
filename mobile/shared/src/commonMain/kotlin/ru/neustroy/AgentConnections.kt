package ru.neustroy

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

@Composable
fun AgentConnectionPanel(s: AppState) {
    var status by remember { mutableStateOf(obj()) }
    var url by remember { mutableStateOf("") }
    suspend fun load() {
        status = s.repo.call("agent-connection").jsonObject
    }
    LaunchedEffect(s.repo) {
        try {
            load()
            if (status.text("provider").isNotEmpty() && s.provider == "basic")
                s.provider = status.text("provider")
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {}
    }
    if (!status.flag("storage")) return
    if (status.text("provider").isNotEmpty()) Text("В профиле подключён ${status.text("provider")}")
    if (s.provider in listOf("openai", "openrouter", "groq", "deepseek")) {
        Action("Сохранить ключ в профиле", !s.busy && s.apiKey.length >= 8) {
            s.run {
                s.repo.call(
                    "agent-connection",
                    "PUT",
                    obj("provider" to s.provider, "apiKey" to s.apiKey),
                )
                s.apiKey = ""
                load()
            }
        }
    }
    Action("Подключить аккаунт OpenRouter", !s.busy) {
        s.run { url = s.repo.call("agent-connection/start", "POST").jsonObject.text("url") }
    }
    if (url.isNotEmpty()) {
        Text(
            "В браузере подтвердите подключение из того же аккаунта neustroy, затем обновите статус."
        )
        Action("Продолжить в OpenRouter") { s.actions.openUrl(url) }
    }
    Action("Обновить подключение", !s.busy) {
        s.run {
            load()
            status.text("provider").takeIf { it.isNotEmpty() }?.let { s.provider = it }
        }
    }
    if (status.text("provider").isNotEmpty())
        Action("Отключить сохранённый ключ", !s.busy) {
            s.run {
                s.repo.call("agent-connection", "DELETE")
                status = status.changed("provider" to "")
                s.provider = "basic"
                s.apiKey = ""
                url = ""
            }
        }
}

suspend fun offlineAgent(s: AppState, action: String, prompt: String, edition: String): JsonObject {
    val idea = prompt.trim().take(240)
    val result =
        when (action) {
            "rules" -> {
                val words =
                    Regex("[\\p{L}0-9-]{3,}").findAll(prompt.lowercase()).map { it.value }.toSet()
                val library = s.rules
                val matches =
                    ((library?.classRows ?: emptyList()) + (library?.spellRows ?: emptyList()))
                        .filter { it["document"].asObject().text("key") == edition }
                        .map { row ->
                            row to
                                words.count {
                                    it in (row.text("name") + " " + row.text("desc")).lowercase()
                                }
                        }
                        .filter { it.second > 0 }
                        .sortedByDescending { it.second }
                        .take(6)
                if (matches.isEmpty())
                    "В справочнике не найдено совпадения. Попробуйте английское название правила."
                else
                    matches.joinToString("\n\n") { (row, _) ->
                        "${row.text("name")} · $edition\n${row.text("desc").take(4000)}"
                    }
            }
            "npc" ->
                "Черновик NPC\nЗацепка: $idea\nЦель: вернуть долг до того, как о нём узнает соперник.\nМанера: говорит коротко и замечает мелкие детали.\nТайна: NPC уже сталкивался с этой угрозой."
            "backstory" ->
                "Черновик предыстории\nОснова: $idea\nЧто герой оставил дома? Кто ему помог? Какое старое обещание приведёт к первой игре?"
            "scenario" ->
                "План игры\nТема: $idea\nСтартовая сцена. Два пути к цели. Улика и персонаж, который знает часть правды. Выбор группы, меняющий исход."
            "summary",
            "contradictions" -> {
                val id = s.campaignId
                val notes =
                    if (id.isEmpty()) emptyList()
                    else s.repo.call("campaigns/$id/notes").jsonArray.map { it.jsonObject }
                val log =
                    if (id.isEmpty()) emptyList()
                    else s.repo.call("campaigns/$id/log").jsonArray.map { it.jsonObject }
                val items =
                    notes.take(10).map { it.text("title") + ": " + it.text("body").take(250) } +
                        log.take(10).map { it.text("text").take(250) }
                if (items.isEmpty()) "Добавьте записи в журнал выбранной кампании."
                else items.joinToString("\n", prefix = "Выдержки из журнала\n") { "• $it" }
            }
            else -> error("Для распознавания и изображений выберите совместимую модель на сервере")
        }
    return obj("text" to result, "mode" to "basic")
}
