package ru.neustroy

import io.ktor.client.*
import io.ktor.client.plugins.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.time.Clock
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

expect fun platformHttpClient(): HttpClient

interface Repository {
    val offline: Boolean

    suspend fun call(path: String, method: String = "GET", data: JsonElement? = null): JsonElement

    suspend fun upload(id: String, file: MobileFile)

    suspend fun download(id: String): MobileFile

    suspend fun portrait(id: String, file: MobileFile? = null): MobileFile

    fun close() {}
}

class RemoteRepository(
    rawUrl: String,
    private val store: Storage,
    private val transport: HttpClient = platformHttpClient(),
) : Repository {
    val url = ConnectionPolicy.normalize(rawUrl)
    override val offline = false
    private val tokenKey = "session-$url"
    var token = store.read(tokenKey) ?: ""
        set(value) {
            store.write(tokenKey, value.ifEmpty { null })
            field = value
        }

    private val client =
        transport.config {
            followRedirects = false
            install(HttpTimeout) {
                requestTimeoutMillis = 180000
                connectTimeoutMillis = 15000
            }
        }
    private val cookieKey = "lan-cookie-$url"
    private var cookie = store.read(cookieKey) ?: ""

    private suspend fun send(
        path: String,
        method: String,
        data: Any? = null,
        mime: String? = null,
        filename: String? = null,
    ): HttpResponse {
        val response =
            client.request("$url/api/$path") {
                this.method = HttpMethod.parse(method)
                header("X-Neustroy-Client", "native")
                if (token.isNotEmpty()) bearerAuth(token)
                if (cookie.isNotEmpty()) header(HttpHeaders.Cookie, cookie)
                if (mime != null) header(HttpHeaders.ContentType, mime)
                if (filename != null) header("X-File-Name", filename.encodeURLParameter())
                if (data != null) setBody(data)
            }
        response.headers
            .getAll(HttpHeaders.SetCookie)
            ?.firstOrNull { it.startsWith("neustroy_device=") }
            ?.let {
                cookie = it.substringBefore(';')
                store.write(cookieKey, cookie)
            }
        if (response.status.value in 300..399)
            error(
                "Сервер закрыт внешней авторизацией. Используйте локальный режим или доступный API-сервер; приватность сайта сохраняется."
            )
        if (!response.status.isSuccess()) {
            if (response.status == HttpStatusCode.Unauthorized && !path.startsWith("auth/"))
                token = ""
            val body = response.bodyAsText()
            error(
                runCatching { codec.parseToJsonElement(body).jsonObject.text("error") }
                    .getOrNull()
                    ?.takeIf { it.isNotBlank() } ?: "Ошибка API ${response.status.value}"
            )
        }
        return response
    }

    override suspend fun call(path: String, method: String, data: JsonElement?): JsonElement =
        try {
            codec.parseToJsonElement(
                send(path, method, data?.toString(), if (data != null) "application/json" else null)
                    .bodyAsText()
            )
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            throw IllegalStateException(e.message ?: "Нет соединения с сервером", e)
        }

    override suspend fun upload(id: String, file: MobileFile) {
        require(file.bytes.size <= 5 * 1024 * 1024) { "Файл больше 5 МБ" }
        send("clues/$id/file", "PUT", file.bytes, file.mime, file.name)
    }

    override suspend fun download(id: String): MobileFile {
        val r = send("clues/$id/file", "GET")
        return MobileFile(
            "material-${id.take(8)}.${when(r.contentType()?.contentType+"/"+r.contentType()?.contentSubtype){"image/jpeg"->"jpg"
"image/png"->"png"
"image/webp"->"webp"
"application/pdf"->"pdf"
else->"txt"}}",
            r.contentType()?.toString() ?: "application/octet-stream",
            r.readRawBytes(),
        )
    }

    override suspend fun portrait(id: String, file: MobileFile?): MobileFile {
        if (file != null) {
            require(file.bytes.size <= 5 * 1024 * 1024) { "Изображение больше 5 МБ" }
            send("characters/$id/portrait", "PUT", file.bytes, file.mime, file.name)
            return file
        }
        val r = send("characters/$id/portrait", "GET")
        return MobileFile(
            "portrait.jpg",
            r.contentType()?.toString() ?: "image/jpeg",
            r.readRawBytes(),
        )
    }

    override fun close() {
        client.close()
        transport.close()
    }
}

val defaultSettings =
    obj(
        "pricing" to
            obj(
                "hour" to 2000,
                "extraPlayer" to 500,
                "offline" to 1500,
                "customCharacter" to 500,
                "chronicle" to 2500,
                "video" to 1500,
                "miniatures" to 800,
            ),
        "about" to "neustroy · настольные приключения",
        "contact" to "",
        "offer" to "",
        "agreement" to "",
        "timezone" to "Europe/Moscow",
    )

fun quote(b: JsonObject, p: JsonObject): Int =
    b.number("hours") * p.number("hour") +
        (b.number("players") - 4).coerceAtLeast(0) * p.number("extraPlayer") +
        (if (b.text("format") == "offline") p.number("offline") else 0) +
        (if (b.text("characters") == "custom") b.number("players") * p.number("customCharacter")
        else 0) +
        b.strings("extras").distinct().sumOf {
            p.number(it) * (if (it == "miniatures") b.number("players") else 1)
        }

@OptIn(ExperimentalEncodingApi::class)
class LocalRepository(private val store: Storage) : Repository {
    override val offline = true
    private val mutex = Mutex()
    private var state: JsonObject =
        store.read("local-game-v1")?.let { codec.parseToJsonElement(it).jsonObject } ?: obj()
    private val user = "local-owner"
    private val ok = obj("ok" to true)

    private fun rows(key: String) = state.rows(key)

    private fun save(key: String, data: Any?) {
        val next = state.changed(key to data)
        store.write("local-game-v1", next.toString())
        state = next
    }

    private fun add(key: String, data: JsonObject): JsonObject {
        save(key, rows(key) + data)
        return data
    }

    private fun update(key: String, id: String, change: (JsonObject) -> JsonObject): JsonObject {
        val old = rows(key).find { it.text("id") == id } ?: error("Запись не найдена")
        val next = change(old)
        save(key, rows(key).map { if (it.text("id") == id) next else it })
        return next
    }

    override suspend fun call(path: String, method: String, data: JsonElement?): JsonElement =
        mutex.withLock {
            val parts = path.substringBefore('?').split('/')
            val root = parts[0]
            val id = parts.getOrNull(1) ?: ""
            val action = parts.getOrNull(2) ?: ""
            val b = (data as? JsonObject) ?: obj()
            when (root) {
                "me" ->
                    obj(
                        "user" to
                            obj("id" to user, "name" to (store.read("player-name") ?: "Мастер")),
                        "isAdmin" to true,
                        "assistantEnabled" to state["agents"].asObject().enabled("enabled"),
                        "local" to true,
                        "integrations" to obj(),
                    )
                "agent-preferences" ->
                    if (method == "PUT") {
                        save("agents", b)
                        b
                    } else state["agents"] ?: obj("enabled" to true)
                "campaign-presets" ->
                    when (method) {
                        "GET" -> JsonArray(defaultPresets() + rows("campaign-presets"))
                        "POST" -> {
                            require(rows(root).size < 30) { "Можно сохранить до 30 шаблонов" }
                            add(root, b.changed("id" to newId(), "owned" to true))
                        }
                        "DELETE" -> {
                            save(root, rows(root).filter { it.text("id") != id })
                            ok
                        }
                        else -> error("Операция недоступна")
                    }
                "settings" ->
                    if (method == "PUT") {
                        save("settings", b)
                        b
                    } else state["settings"] ?: defaultSettings
                "characters" ->
                    when (method) {
                        "GET" -> JsonArray(rows(root))
                        "POST" -> {
                            val c = codec.decodeFromJsonElement<Character>(b).validate()
                            add(
                                root,
                                obj(
                                    "id" to newId(),
                                    "data" to codec.encodeToJsonElement(c),
                                    "revision" to 1,
                                ),
                            )
                        }
                        "PUT" ->
                            update(root, id) { old ->
                                require(old.number("revision") == b.number("revision")) {
                                    "Лист изменён. Перезагрузите перед сохранением."
                                }
                                val c =
                                    codec
                                        .decodeFromJsonElement<Character>(b.getValue("data"))
                                        .validate()
                                old.changed(
                                    "data" to codec.encodeToJsonElement(c),
                                    "revision" to old.number("revision") + 1,
                                )
                            }
                        "DELETE" -> {
                            save(root, rows(root).filter { it.text("id") != id })
                            ok
                        }
                        else -> error("Операция недоступна")
                    }
                "campaigns" ->
                    when {
                        method == "GET" && id == "discover" ->
                            JsonArray(rows(root).filter { it.text("visibility") == "public" })
                        method == "GET" && id.isEmpty() -> JsonArray(rows(root))
                        method == "POST" && id.isEmpty() -> {
                            require(b.text("name").isNotBlank())
                            add(
                                root,
                                obj(
                                    "id" to newId(),
                                    "name" to b.text("name"),
                                    "owner_id" to user,
                                    "invite" to newId(),
                                    "role_id" to "gm",
                                    "visibility" to "private",
                                    "description" to "",
                                    "permissions" to allPermissions,
                                ),
                            )
                        }
                        id == "join" ->
                            error("Для общей игры подключитесь к серверу локальной сети")
                        action == "members" ->
                            JsonArray(
                                listOf(
                                    obj("user_id" to user, "name" to "Мастер", "role_id" to "gm")
                                )
                            )
                        action == "roles" ->
                            JsonArray(
                                defaultRoles.map {
                                    obj(
                                        "id" to it.key,
                                        "name" to it.value.first,
                                        "permissions" to it.value.second,
                                    )
                                }
                            )
                        action == "rules-config" ->
                            if (method == "GET")
                                rows(root).find { it.text("id") == id }?.get("rules_config")
                                    ?: obj(
                                        "mode" to "rules",
                                        "edition" to "srd-2024",
                                        "enabledModules" to listOf("*"),
                                    )
                            else {
                                update(root, id) { it.changed("rules_config" to b) }
                                b
                            }
                        action == "documents" ->
                            when (method) {
                                "GET" ->
                                    JsonArray(
                                        rows("documents").filter { it.text("campaign_id") == id }
                                    )
                                "POST" ->
                                    add(
                                        "documents",
                                        b.changed(
                                            "id" to newId(),
                                            "campaign_id" to id,
                                            "user_id" to user,
                                            "created_at" to now(),
                                            "updated_at" to now(),
                                            "revision" to 1,
                                        ),
                                    )
                                "PUT" ->
                                    update("documents", parts.getOrNull(3) ?: "") { old ->
                                        require(old.number("revision") == b.number("revision")) {
                                            "Запись изменилась"
                                        }
                                        b.changed(
                                            "id" to old["id"],
                                            "campaign_id" to id,
                                            "user_id" to user,
                                            "revision" to old.number("revision") + 1,
                                            "updated_at" to now(),
                                        )
                                    }
                                "DELETE" -> {
                                    save(
                                        "documents",
                                        rows("documents").filter {
                                            it.text("id") != parts.getOrNull(3)
                                        },
                                    )
                                    ok
                                }
                                else -> error("Операция недоступна")
                            }
                        action == "chat" ->
                            if (method == "GET")
                                JsonArray(rows("chat").filter { it.text("campaign_id") == id })
                            else
                                add(
                                    "chat",
                                    b.changed(
                                        "id" to newId(),
                                        "campaign_id" to id,
                                        "author_id" to user,
                                        "author_name" to "Мастер",
                                        "created_at" to now(),
                                    ),
                                )
                        action == "log" ->
                            if (method == "GET")
                                JsonArray(rows("log").filter { it.text("campaign_id") == id })
                            else
                                add(
                                    "log",
                                    b.changed(
                                        "id" to newId(),
                                        "campaign_id" to id,
                                        "user_id" to user,
                                        "user_name" to "Мастер",
                                        "created_at" to now(),
                                    ),
                                )
                        action == "invite" -> update(root, id) { it.changed("invite" to newId()) }
                        action == "folders" ->
                            when {
                                method == "GET" ->
                                    JsonArray(
                                        rows("folders").filter { it.text("campaign_id") == id }
                                    )
                                parts.getOrNull(3) == "organize" -> {
                                    for ((name, kind) in
                                        listOf(
                                            "Улики" to "note",
                                            "Переписки" to "chat",
                                            "Изображения" to "photo",
                                            "Журнал" to "journal",
                                        )) if (
                                        rows("folders").none {
                                            it.text("campaign_id") == id && it.text("name") == name
                                        }
                                    )
                                        add(
                                            "folders",
                                            obj(
                                                "id" to newId(),
                                                "campaign_id" to id,
                                                "name" to name,
                                                "kind" to kind,
                                                "parent_id" to null,
                                                "position" to rows("folders").size,
                                            ),
                                        )
                                    ok
                                }
                                method == "POST" ->
                                    add(
                                        "folders",
                                        b.changed(
                                            "id" to newId(),
                                            "campaign_id" to id,
                                            "parent_id" to b["parentId"],
                                            "position" to 0,
                                        ),
                                    )
                                method == "PATCH" ->
                                    update("folders", parts.getOrNull(3) ?: "") {
                                        it.changed(
                                            "name" to b["name"],
                                            "parent_id" to b["parentId"],
                                            "position" to b["position"],
                                        )
                                    }
                                else -> error("Операция недоступна")
                            }
                        action == "notes" ->
                            when (method) {
                                "GET" ->
                                    JsonArray(rows("notes").filter { it.text("campaign_id") == id })
                                "POST" -> {
                                    require(
                                        b.text("title").isNotBlank() &&
                                            b.text("body").length <= 20000
                                    )
                                    add(
                                        "notes",
                                        b.changed(
                                            "id" to newId(),
                                            "campaign_id" to id,
                                            "user_id" to user,
                                            "author_name" to "Мастер",
                                            "created_at" to now(),
                                            "updated_at" to now(),
                                            "revision" to 1,
                                        ),
                                    )
                                }
                                "PUT" ->
                                    update("notes", parts.getOrNull(3) ?: "") {
                                        require(it.number("revision") == b.number("revision")) {
                                            "Заметка изменилась, обновите журнал"
                                        }
                                        it.changed(
                                            "title" to b["title"],
                                            "body" to b["body"],
                                            "visibility" to b["visibility"],
                                            "links" to b["links"],
                                            "folder_id" to b["folderId"],
                                            "session_id" to b["sessionId"],
                                            "updated_at" to now(),
                                            "revision" to it.number("revision") + 1,
                                        )
                                    }
                                "DELETE" -> {
                                    save(
                                        "notes",
                                        rows("notes").filter { it.text("id") != parts.getOrNull(3) },
                                    )
                                    ok
                                }
                                else -> error("Операция недоступна")
                            }
                        method == "PATCH" && action.isEmpty() ->
                            update(root, id) {
                                it.changed(
                                    "name" to b["name"],
                                    "description" to b["description"],
                                    "visibility" to "private",
                                    "listing" to b["listing"],
                                )
                            }
                        else -> error("Для управления участниками нужен сервер общей игры")
                    }
                "sessions" ->
                    when {
                        method == "GET" -> JsonArray(rows(root).sortedBy { it.text("start") })
                        method == "POST" && id.isEmpty() -> {
                            require(b.text("title").isNotBlank())
                            require(
                                kotlin.time.Instant.parse(b.text("start")) > Clock.System.now()
                            ) {
                                "Укажите будущую дату"
                            }
                            add(
                                root,
                                b.changed(
                                    "id" to newId(),
                                    "campaign_id" to b["campaignId"],
                                    "owner_id" to user,
                                    "status" to "proposed",
                                    "votes" to emptyList<String>(),
                                    "attendees" to emptyList<String>(),
                                ),
                            )
                        }
                        action == "confirm" ->
                            update(root, id) { s ->
                                require(
                                    rows(root).none {
                                        it.text("id") != id &&
                                            it.text("status") == "confirmed" &&
                                            it.text("start") < s.text("end") &&
                                            it.text("end") > s.text("start")
                                    }
                                ) {
                                    "Это время занято"
                                }
                                s.changed("status" to "confirmed")
                            }
                        action == "cancel" ->
                            update(root, id) { it.changed("status" to "cancelled") }
                        action == "vote" ->
                            update(root, id) {
                                it.changed(
                                    "votes" to
                                        listOf(
                                            obj(
                                                "user_id" to user,
                                                "name" to "Мастер",
                                                "answer" to b.text("answer"),
                                            )
                                        )
                                )
                            }
                        action == "join" ->
                            update(root, id) {
                                it.changed(
                                    "attendees" to
                                        if (method == "DELETE") emptyList<String>()
                                        else listOf(obj("user_id" to user, "name" to "Мастер"))
                                )
                            }
                        else -> error("Операция недоступна")
                    }
                "clues" ->
                    when (method) {
                        "GET" ->
                            JsonArray(
                                rows(root).filter {
                                    it.text("campaign_id") == path.substringAfter("campaign=", "")
                                }
                            )
                        "POST" -> {
                            require(b.text("title").isNotBlank())
                            add(
                                root,
                                b.changed(
                                    "id" to newId(),
                                    "campaign_id" to b["campaignId"],
                                    "folder_id" to b["folderId"],
                                    "visible_roles" to b["roles"],
                                ),
                            )
                        }
                        "PATCH" ->
                            update(root, id) {
                                it.changed(
                                    *b.map { entry -> entry.key to entry.value }.toTypedArray()
                                )
                            }
                        "DELETE" -> {
                            save(root, rows(root).filter { it.text("id") != id })
                            ok
                        }
                        else -> error("Операция недоступна")
                    }
                "rule-packs" ->
                    when (method) {
                        "GET" -> JsonArray(rows(root))
                        "POST" -> add(root, b.changed("id" to newId()))
                        "DELETE" -> {
                            save(root, rows(root).filter { it.text("id") != id })
                            ok
                        }
                        else -> error("Операция недоступна")
                    }
                "bookings" ->
                    when {
                        method == "GET" -> JsonArray(rows(root))
                        method == "POST" && id.isEmpty() ->
                            add(
                                root,
                                obj(
                                    "id" to newId(),
                                    "data" to b,
                                    "total" to
                                        quote(
                                            b,
                                            (state["settings"]?.jsonObject ?: defaultSettings)
                                                .getValue("pricing")
                                                .jsonObject,
                                        ),
                                    "status" to "pending",
                                    "created_at" to now(),
                                ),
                            )
                        method == "PATCH" ->
                            update(root, id) {
                                it.changed(
                                    "data" to
                                        it.getValue("data")
                                            .jsonObject
                                            .changed("start" to b["start"])
                                )
                            }
                        action in listOf("confirm", "decline") ->
                            update(root, id) {
                                it.changed(
                                    "status" to if (action == "confirm") "confirmed" else "declined"
                                )
                            }
                        else -> error("Операция недоступна")
                    }
                "availability" ->
                    obj(
                        "busy" to
                            rows("sessions")
                                .filter { it.text("status") == "confirmed" }
                                .map { obj("start" to it["start"], "end" to it["end"]) },
                        "externalConnected" to false,
                    )
                "outbox" -> if (method == "GET") JsonArray(emptyList()) else ok
                "assistant" ->
                    error(
                        "В автономном режиме используйте поиск в библиотеке. Для модели подключите API-сервер."
                    )
                else -> error("Маршрут недоступен в локальном режиме")
            }
        }

    override suspend fun upload(id: String, file: MobileFile) =
        mutex.withLock {
            require(file.bytes.size <= 5 * 1024 * 1024) { "Файл больше 5 МБ" }
            update("clues", id) {
                it.changed(
                    "file_key" to id,
                    "file_name" to file.name,
                    "mime" to file.mime,
                    "bytes" to Base64.encode(file.bytes),
                )
            }
            Unit
        }

    override suspend fun download(id: String): MobileFile =
        mutex.withLock {
            val f = rows("clues").find { it.text("id") == id } ?: error("Файл не найден")
            require(f.text("bytes").isNotEmpty()) { "Нет вложения" }
            MobileFile(f.text("file_name"), f.text("mime"), Base64.decode(f.text("bytes")))
        }

    override suspend fun portrait(id: String, file: MobileFile?): MobileFile =
        mutex.withLock {
            require(rows("characters").any { it.text("id") == id }) {
                "Сначала сохраните персонажа"
            }
            if (file != null) {
                require(
                    file.mime in listOf("image/jpeg", "image/png", "image/webp") &&
                        file.bytes.size <= 5 * 1024 * 1024
                ) {
                    "Выберите JPG, PNG или WebP до 5 МБ"
                }
                store.write(
                    "portrait-$id",
                    obj("mime" to file.mime, "bytes" to Base64.encode(file.bytes)).toString(),
                )
                file
            } else {
                val saved =
                    store.read("portrait-$id")?.let { codec.parseToJsonElement(it).jsonObject }
                        ?: error("Портрет не добавлен")
                MobileFile("portrait.jpg", saved.text("mime"), Base64.decode(saved.text("bytes")))
            }
        }
}

val allPermissions =
    listOf(
        "view_materials",
        "edit_materials",
        "manage_members",
        "manage_sessions",
        "write_shared_notes",
        "publish_campaign",
        "manage_rules",
    )
val defaultRoles =
    linkedMapOf(
        "gm" to ("Мастер" to allPermissions),
        "player" to ("Игрок" to listOf("view_materials", "write_shared_notes")),
        "observer" to ("Наблюдатель" to listOf("view_materials")),
    )
