package ru.neustroy

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.jetbrains.compose.resources.decodeToImageBitmap

@Composable
fun CampaignScreen(s: AppState) {
    var tab by remember { mutableStateOf("games") }
    var name by remember { mutableStateOf("") }
    var invite by remember { mutableStateOf("") }
    var discover by remember { mutableStateOf(emptyList<JsonObject>()) }
    PageColumn {
        Message(s)
        CampaignChoice(s)
        Choice(
            "Раздел",
            tab,
            mapOf(
                "games" to "Мои игры",
                "materials" to "Материалы и карты",
                "access" to "Редактор мастера",
            ),
        ) {
            tab = it
        }
        when (tab) {
            "games" -> {
                Panel("Новая игра") {
                    Input("Название", name, { name = it })
                    Action("Создать игру", !s.busy) {
                        s.run {
                            val r = s.repo.call("campaigns", "POST", obj("name" to name)).jsonObject
                            s.refresh()
                            s.campaignId = r.text("id")
                            name = ""
                        }
                    }
                }
                if (!s.repo.offline)
                    Panel("Присоединиться") {
                        Input("Приглашение", invite, { invite = it })
                        Action("Вступить по приглашению", !s.busy) {
                            s.run {
                                s.repo.call("campaigns/join", "POST", obj("invite" to invite))
                                s.refresh()
                                invite = ""
                            }
                        }
                        Action("Найти открытые игры", !s.busy) {
                            s.run {
                                discover =
                                    s.repo.call("campaigns/discover").jsonArray.map {
                                        it.jsonObject
                                    }
                            }
                        }
                        discover.forEach { game ->
                            Panel(game.text("name")) {
                                Text(game.text("description"))
                                Action("Присоединиться как наблюдатель", !s.busy) {
                                    s.run {
                                        s.repo.call(
                                            "campaigns/${game.text("id")}/join-public",
                                            "POST",
                                        )
                                        s.refresh()
                                        s.campaignId = game.text("id")
                                    }
                                }
                            }
                        }
                    }
                s.campaigns.forEach { game ->
                    Panel(game.text("name")) {
                        Text(game.text("description"))
                        Text(
                            "${if(game.text("visibility")=="public")"Открытая игра" else "По приглашению"} · ${game.text("role_id")}"
                        )
                        if (game.text("invite").isNotEmpty())
                            Text("Приглашение: ${game.text("invite")}")
                        Action("Открыть материалы") {
                            s.campaignId = game.text("id")
                            tab = "materials"
                        }
                    }
                }
            }
            "materials" -> if (s.campaignId.isNotEmpty()) MaterialEditor(s)
            "access" -> if (s.campaignId.isNotEmpty()) AccessEditor(s)
        }
    }
}

@Composable
fun AccessEditor(s: AppState) {
    val cid = s.campaignId
    var members by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var roles by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var title by remember(cid) { mutableStateOf(s.campaign?.text("name") ?: "") }
    var description by remember(cid) { mutableStateOf(s.campaign?.text("description") ?: "") }
    var public by remember(cid) { mutableStateOf(s.campaign?.text("visibility") == "public") }
    var roleId by remember { mutableStateOf("") }
    var roleName by remember { mutableStateOf("") }
    var permissions by remember { mutableStateOf(emptyList<String>()) }
    suspend fun load() {
        members = s.repo.call("campaigns/$cid/members").jsonArray.map { it.jsonObject }
        roles = s.repo.call("campaigns/$cid/roles").jsonArray.map { it.jsonObject }
    }
    LaunchedEffect(cid) {
        try {
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Ошибка доступа"
        }
    }
    Panel("Параметры игры") {
        Input("Название", title, { title = it })
        Input("Описание для поиска игроков", description, { description = it }, true)
        Toggle("Показывать игру другим пользователям сервиса", public) { public = it }
        Action("Сохранить игру", s.can("publish_campaign") && !s.busy) {
            s.run {
                s.repo.call(
                    "campaigns/$cid",
                    "PATCH",
                    obj(
                        "name" to title,
                        "description" to description,
                        "visibility" to if (public) "public" else "private",
                    ),
                )
                s.refresh()
            }
        }
        if (s.can("manage_members"))
            Action("Обновить приглашение", !s.busy) {
                s.run {
                    s.repo.call("campaigns/$cid/invite", "POST")
                    s.refresh()
                }
            }
    }
    Panel("Участники и роли") {
        members.forEach { member ->
            Text(member.text("name"))
            Choice(
                "Роль",
                member.text("role_id", "player"),
                roles.associate { it.text("id") to it.text("name") },
            ) { role ->
                s.run {
                    s.repo.call(
                        "campaigns/$cid/members/${member.text("user_id")}",
                        "PATCH",
                        obj("roleId" to role),
                    )
                    load()
                }
            }
        }
    }
    if (s.campaign?.text("owner_id") == s.userId)
        Panel("Настроить роль") {
            Choice(
                "Шаблон",
                roleId,
                mapOf("" to "Новая роль") +
                    roles
                        .filter { it.text("id") != "gm" }
                        .associate { it.text("id") to it.text("name") },
            ) { id ->
                roleId = id
                val r = roles.find { it.text("id") == id }
                roleName = r?.text("name") ?: ""
                permissions = r?.strings("permissions") ?: emptyList()
            }
            Input("Код роли · латиница", roleId, { roleId = it })
            Input("Название роли", roleName, { roleName = it })
            allPermissions.forEach { p ->
                Toggle(permissionNames[p] ?: p, p in permissions) { v ->
                    permissions = if (v) (permissions + p).distinct() else permissions - p
                }
            }
            Action("Сохранить роль", !s.busy) {
                s.run {
                    s.repo.call(
                        "campaigns/$cid/roles",
                        "PUT",
                        obj("id" to roleId, "name" to roleName, "permissions" to permissions),
                    )
                    load()
                }
            }
        }
    CampaignRulesEditor(s)
}

val permissionNames =
    mapOf(
        "view_materials" to "Читать открытые материалы",
        "edit_materials" to "Редактировать материалы и папки",
        "manage_members" to "Назначать роли участникам",
        "manage_sessions" to "Создавать встречи",
        "write_shared_notes" to "Писать общие заметки",
        "publish_campaign" to "Публиковать игру",
        "manage_rules" to "Настраивать правила игры",
    )

@Composable
fun MaterialEditor(s: AppState) {
    val cid = s.campaignId
    var clues by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var folders by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var roles by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var members by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var folder by remember(cid) { mutableStateOf("") }
    var editing by remember { mutableStateOf<JsonObject?>(null) }
    var opened by remember { mutableStateOf<MobileFile?>(null) }
    var name by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("note") }
    var revealed by remember { mutableStateOf(false) }
    var audience by remember { mutableStateOf(emptyList<String>()) }
    var recipients by remember { mutableStateOf(emptyList<String>()) }
    var targetFolder by remember { mutableStateOf("") }
    var attachment by remember { mutableStateOf<MobileFile?>(null) }
    var folderName by remember { mutableStateOf("") }
    var parent by remember { mutableStateOf("") }
    suspend fun load() {
        clues = s.repo.call("clues?campaign=$cid").jsonArray.map { it.jsonObject }
        folders = s.repo.call("campaigns/$cid/folders").jsonArray.map { it.jsonObject }
        roles = s.repo.call("campaigns/$cid/roles").jsonArray.map { it.jsonObject }
        members = s.repo.call("campaigns/$cid/members").jsonArray.map { it.jsonObject }
    }
    LaunchedEffect(cid) {
        try {
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Не удалось загрузить материалы"
        }
    }
    Choice(
        "Папка",
        folder,
        mapOf("" to "Все материалы") + folders.associate { it.text("id") to it.text("name") },
    ) {
        folder = it
    }
    if (s.can("edit_materials")) {
        Action("Новый материал / карта") {
            editing = obj()
            name = ""
            body = ""
            kind = "note"
            revealed = false
            audience = emptyList()
            recipients = emptyList()
            targetFolder = folder
            attachment = null
        }
        Panel("Папки") {
            Input("Название новой папки", folderName, { folderName = it })
            Choice(
                "Родительская папка",
                parent,
                mapOf("" to "Корень игры") + folders.associate { it.text("id") to it.text("name") },
            ) {
                parent = it
            }
            Action("Создать папку", !s.busy) {
                s.run {
                    s.repo.call(
                        "campaigns/$cid/folders",
                        "POST",
                        obj(
                            "name" to folderName,
                            "parentId" to parent.ifBlank { null },
                            "roles" to emptyList<String>(),
                            "recipients" to emptyList<String>(),
                        ),
                    )
                    folderName = ""
                    load()
                }
            }
            Action("Автоматически разложить материалы", !s.busy) {
                s.run {
                    s.repo.call("campaigns/$cid/folders/organize", "POST")
                    load()
                }
            }
            val current = folders.find { it.text("id") == folder }
            if (current != null) FolderAccess(s, current, folders, roles, members) { load() }
        }
    }
    if (editing != null)
        Panel(if (editing!!.text("id").isEmpty()) "Новый материал" else "Редактировать материал") {
            Input("Название", name, { name = it })
            Choice(
                "Тип",
                kind,
                mapOf(
                    "note" to "Улика / текст",
                    "chat" to "Переписка из сюжета",
                    "photo" to "Изображение",
                    "map" to "Карта",
                ),
            ) {
                kind = it
            }
            Input("Содержимое или HTTPS-ссылка на карту", body, { body = it }, true)
            Choice(
                "Расположение",
                targetFolder,
                mapOf("" to "Без папки") + folders.associate { it.text("id") to it.text("name") },
            ) {
                targetFolder = it
            }
            Toggle("Открыть игрокам", revealed) { revealed = it }
            Text("Роли · пустой список означает все роли с правом чтения")
            roles
                .filter { it.text("id") != "gm" }
                .forEach { role ->
                    val id = role.text("id")
                    Toggle(role.text("name"), id in audience) { v ->
                        audience = if (v) audience + id else audience - id
                    }
                }
            Text("Личный доступ")
            members
                .filter { it.text("user_id") != s.userId }
                .forEach { m ->
                    val id = m.text("user_id")
                    Toggle(m.text("name"), id in recipients) { v ->
                        recipients = if (v) recipients + id else recipients - id
                    }
                }
            OutlinedButton(onClick = { s.actions.importFile { attachment = it } }) {
                Text(attachment?.name ?: "Прикрепить изображение / PDF / текст · до 5 МБ")
            }
            Action("Сохранить материал", !s.busy) {
                s.run {
                    val id = editing!!.text("id")
                    val b =
                        obj(
                            "campaignId" to cid,
                            "title" to name,
                            "body" to body,
                            "kind" to kind,
                            "revealed" to revealed,
                            "roles" to audience,
                            "recipients" to recipients,
                            "folderId" to targetFolder.ifBlank { null },
                        )
                    val result =
                        s.repo
                            .call(
                                if (id.isEmpty()) "clues" else "clues/$id",
                                if (id.isEmpty()) "POST" else "PATCH",
                                b,
                            )
                            .jsonObject
                    val savedId = id.ifBlank { result.text("id") }
                    attachment?.let { s.repo.upload(savedId, it) }
                    editing = null
                    attachment = null
                    load()
                }
            }
            TextButton({ editing = null }) { Text("Отмена") }
        }
    if (opened != null)
        Panel(opened!!.name) {
            if (opened!!.mime.startsWith("image/")) {
                val bitmap =
                    remember(opened) {
                        runCatching { opened!!.bytes.decodeToImageBitmap() }.getOrNull()
                    }
                if (bitmap != null)
                    Image(
                        bitmap,
                        contentDescription = opened!!.name,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 600.dp),
                    )
            } else if (opened!!.mime.startsWith("text/")) Text(opened!!.bytes.decodeToString())
            Action("Открыть / сохранить файл") { s.actions.exportFile(opened!!) }
            TextButton({ opened = null }) { Text("Закрыть") }
        }
    clues
        .filter { folder.isEmpty() || it.text("folder_id") == folder }
        .forEach { clue ->
            Panel(clue.text("title")) {
                Text(clue.text("body"))
                Text(
                    if (clue.flag("revealed")) "Открыто по ролям"
                    else "Закрыто · только назначенные получатели",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (clue.text("body").trim().startsWith("https://"))
                    Action("Открыть ссылку") { s.actions.openUrl(clue.text("body").trim()) }
                if (clue.text("file_key").isNotEmpty())
                    Action("Посмотреть вложение", !s.busy) {
                        s.run { opened = s.repo.download(clue.text("id")) }
                    }
                if (s.can("edit_materials")) {
                    Action("Редактировать доступ и материал") {
                        editing = clue
                        name = clue.text("title")
                        body = clue.text("body")
                        kind = clue.text("kind")
                        revealed = clue.flag("revealed")
                        audience = clue.strings("roles")
                        recipients = clue.strings("recipients")
                        targetFolder = clue.text("folder_id")
                        attachment = null
                    }
                    TextButton({
                        s.run {
                            s.repo.call("clues/${clue.text("id")}", "DELETE")
                            load()
                        }
                    }) {
                        Text("Удалить")
                    }
                }
            }
        }
}

@Composable
fun FolderAccess(
    s: AppState,
    f: JsonObject,
    folders: List<JsonObject>,
    roles: List<JsonObject>,
    members: List<JsonObject>,
    reload: suspend () -> Unit,
) {
    var name by remember(f) { mutableStateOf(f.text("name")) }
    var parent by remember(f) { mutableStateOf(f.text("parent_id")) }
    var position by remember(f) { mutableStateOf(f.number("position").toString()) }
    var audience by remember(f) { mutableStateOf(f.strings("roles")) }
    var recipients by remember(f) { mutableStateOf(f.strings("recipients")) }
    Input("Имя выбранной папки", name, { name = it })
    Choice(
        "Переместить в",
        parent,
        mapOf("" to "Корень") +
            folders
                .filter { it.text("id") != f.text("id") }
                .associate { it.text("id") to it.text("name") },
    ) {
        parent = it
    }
    Input("Порядок", position, { position = it })
    roles
        .filter { it.text("id") != "gm" }
        .forEach { r ->
            val id = r.text("id")
            Toggle("Папка для роли ${r.text("name")}", id in audience) { v ->
                audience = if (v) audience + id else audience - id
            }
        }
    members
        .filter { it.text("user_id") != s.userId }
        .forEach { m ->
            val id = m.text("user_id")
            Toggle("Папка для ${m.text("name")}", id in recipients) { v ->
                recipients = if (v) recipients + id else recipients - id
            }
        }
    Text(
        "Пустые списки — доступ всем участникам. Ограничения родительской папки сохраняются.",
        style = MaterialTheme.typography.bodySmall,
    )
    Action("Сохранить папку", !s.busy) {
        s.run {
            s.repo.call(
                "campaigns/${s.campaignId}/folders/${f.text("id")}",
                "PATCH",
                obj(
                    "name" to name,
                    "parentId" to parent.ifBlank { null },
                    "position" to (position.toIntOrNull() ?: 0),
                    "roles" to audience,
                    "recipients" to recipients,
                ),
            )
            reload()
        }
    }
}

@Composable
fun JournalScreen(s: AppState) {
    val cid = s.campaignId
    var notes by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var clues by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var folders by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var editing by remember(cid) { mutableStateOf<JsonObject?>(null) }
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var shared by remember { mutableStateOf(false) }
    var links by remember { mutableStateOf(emptyList<String>()) }
    var session by remember { mutableStateOf("") }
    var folder by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("all") }
    var query by remember { mutableStateOf("") }
    suspend fun load() {
        if (cid.isNotEmpty()) {
            notes = s.repo.call("campaigns/$cid/notes").jsonArray.map { it.jsonObject }
            clues = s.repo.call("clues?campaign=$cid").jsonArray.map { it.jsonObject }
            folders = s.repo.call("campaigns/$cid/folders").jsonArray.map { it.jsonObject }
        }
    }
    LaunchedEffect(cid) {
        try {
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            s.error = e.message ?: "Ошибка журнала"
        }
    }
    fun begin(n: JsonObject? = null) {
        editing = n ?: obj()
        title = n?.text("title") ?: ""
        body = n?.text("body") ?: ""
        shared = n?.text("visibility") == "shared"
        links = n?.strings("links") ?: emptyList()
        session = n?.text("session_id") ?: ""
        folder = n?.text("folder_id") ?: ""
    }
    PageColumn {
        Message(s)
        CampaignChoice(s)
        if (cid.isEmpty()) Text("Создайте или выберите игру, чтобы вести журнал.")
        else {
            Action("Быстрая запись") { begin() }
            if (editing != null)
                Panel("Запись в журнал") {
                    Input("Название", title, { title = it })
                    Input("Заметка", body, { body = it }, true)
                    Action("Продиктовать") {
                        s.actions.dictate {
                            if (it != null) body += (if (body.isEmpty()) "" else "\n") + it
                        }
                    }
                    Toggle("Общая запись · видна участникам с доступом", shared) { shared = it }
                    Text(
                        if (shared) "Игроки увидят запись после сохранения."
                        else "Личная запись: доступна только вам, включая секреты от мастера.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Choice(
                        "Игровая встреча",
                        session,
                        mapOf("" to "Вся кампания") +
                            s.sessions
                                .filter { it.text("campaign_id") == cid }
                                .associate { it.text("id") to it.text("title") },
                    ) {
                        session = it
                    }
                    Choice(
                        "Папка",
                        folder,
                        mapOf("" to "Без папки") +
                            folders.associate { it.text("id") to it.text("name") },
                    ) {
                        folder = it
                    }
                    Text("Связанные заметки и материалы")
                    (notes.filter {
                            it.text("id") != editing!!.text("id") &&
                                (!shared || it.text("visibility") == "shared")
                        } + clues)
                        .forEach { n ->
                            val id = n.text("id")
                            Toggle(n.text("title"), id in links) { v ->
                                links = if (v) links + id else links - id
                            }
                        }
                    Action("Сохранить запись", !s.busy) {
                        s.run {
                            val id = editing!!.text("id")
                            s.repo.call(
                                "campaigns/$cid/notes${if(id.isBlank())"" else "/$id"}",
                                if (id.isBlank()) "POST" else "PUT",
                                obj(
                                    "title" to title,
                                    "body" to body,
                                    "visibility" to if (shared) "shared" else "private",
                                    "links" to links,
                                    "sessionId" to session.ifBlank { null },
                                    "folderId" to folder.ifBlank { null },
                                    "revision" to editing!!.number("revision", 1),
                                ),
                            )
                            editing = null
                            load()
                        }
                    }
                    TextButton({ editing = null }) { Text("Отмена") }
                }
            Input("Поиск в журнале", query, { query = it })
            Choice(
                "Показать",
                filter,
                mapOf("all" to "Все доступные", "private" to "Мои личные", "shared" to "Общие"),
            ) {
                filter = it
            }
            notes
                .filter {
                    (filter == "all" || it.text("visibility") == filter) &&
                        (it.text("title") + " " + it.text("body")).contains(query, true)
                }
                .forEach { n ->
                    Panel(n.text("title")) {
                        Text(
                            "${if(n.text("visibility")=="private")"Личная" else "Общая"} · ${n.text("author_name")} · ${n.text("updated_at")}",
                            style = MaterialTheme.typography.labelSmall,
                        )
                        Text(n.text("body"))
                        n.strings("links").forEach { id ->
                            val linked = (notes + clues).find { it.text("id") == id }
                            if (linked != null)
                                TextButton({
                                    if (linked in notes) {
                                        query = linked.text("title")
                                        filter = "all"
                                    } else {
                                        s.page = "campaigns"
                                        s.notice = "Материал: ${linked.text("title")}"
                                    }
                                }) {
                                    Text("↗ ${linked.text("title")}")
                                }
                        }
                        if (
                            n.text("user_id") == s.userId ||
                                s.can("edit_materials") && n.text("visibility") == "shared"
                        ) {
                            TextButton({ begin(n) }) { Text("Редактировать") }
                            TextButton({
                                s.run {
                                    s.repo.call("campaigns/$cid/notes/${n.text("id")}", "DELETE")
                                    load()
                                }
                            }) {
                                Text("Удалить")
                            }
                        }
                    }
                }
            if (s.rollHistory.isNotEmpty())
                Panel("Лог бросков на устройстве") {
                    s.rollHistory.take(30).forEach {
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                    Action("Добавить броски в личный журнал") {
                        begin()
                        title = "Броски · ${now().take(10)}"
                        body = s.rollHistory.take(50).reversed().joinToString("\n")
                    }
                }
            Action("Сводка игры с помощником", !s.busy) {
                s.run {
                    val r =
                        s.assistant(
                            "summary",
                            "Подготовь краткую сводку доступного мне журнала этой игры: события, решения, открытые вопросы.",
                        )
                    begin()
                    title = "Сводка · ${now().take(10)}"
                    body = r.text("text")
                    shared = false
                }
            }
            Action("Экспорт доступного журнала") {
                s.actions.exportFile(
                    MobileFile(
                        "journal.json",
                        "application/json",
                        JsonArray(notes).toString().encodeToByteArray(),
                    )
                )
            }
        }
    }
}

@Composable
fun ChatScreen(s: AppState) {
    val cid = s.campaignId
    var peer by remember(cid) { mutableStateOf("") }
    var members by remember(cid) { mutableStateOf(emptyList<JsonObject>()) }
    var messages by remember(cid, peer) { mutableStateOf(emptyList<JsonObject>()) }
    var text by remember { mutableStateOf("") }
    suspend fun load() {
        messages =
            s.repo
                .call("campaigns/$cid/chat" + if (peer.isEmpty()) "" else "?peer=$peer")
                .jsonArray
                .map { it.jsonObject }
    }
    LaunchedEffect(cid, peer) {
        if (cid.isNotEmpty())
            try {
                members = s.repo.call("campaigns/$cid/members").jsonArray.map { it.jsonObject }
                while (isActive) {
                    load()
                    delay(10000)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                s.error = e.message ?: "Не удалось загрузить чат"
            }
    }
    PageColumn {
        Message(s)
        CampaignChoice(s)
        if (cid.isEmpty()) Text("Выберите игру")
        else {
            Choice(
                "Чат",
                peer,
                mapOf("" to "Общий чат игры") +
                    members
                        .filter { it.text("user_id") != s.userId }
                        .associate { it.text("user_id") to "Лично: ${it.text("name")}" },
            ) {
                peer = it
            }
            Text(
                if (peer.isEmpty()) "Сообщения видны участникам игры."
                else
                    "Личная переписка видна только двум собеседникам. Мастер не получает доступ по роли.",
                style = MaterialTheme.typography.bodySmall,
            )
            messages.forEach { m ->
                Panel(m.text("author_name")) {
                    Text(m.text("text"))
                    Text(m.text("created_at"), style = MaterialTheme.typography.labelSmall)
                }
            }
            Input("Сообщение", text, { text = it.take(4000) }, true)
            Action("Отправить", !s.busy && text.isNotBlank()) {
                s.run {
                    s.repo.call(
                        "campaigns/$cid/chat" + if (peer.isEmpty()) "" else "?peer=$peer",
                        "POST",
                        obj("text" to text),
                    )
                    text = ""
                    load()
                }
            }
        }
    }
}
