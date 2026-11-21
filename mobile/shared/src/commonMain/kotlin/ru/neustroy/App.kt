@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package ru.neustroy

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import ru.neustroy.resources.Res

val Ink = Color(0xffe9e3d5)
val Gold = Color(0xffc8ad75)
val Blue = Color(0xff6994ff)
val Night =
    darkColorScheme(
        primary = Blue,
        secondary = Gold,
        background = Color(0xff11151d),
        surface = Color(0xff1b2230),
        onBackground = Ink,
        onSurface = Ink,
    )

class AppState(val store: DeviceStore, val actions: DeviceActions, val scope: CoroutineScope) {
    var repo: Repository by mutableStateOf(LocalRepository(store))
    var connected by mutableStateOf(false)
    var login by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var error by mutableStateOf("")
    var notice by mutableStateOf("")
    var page by mutableStateOf("characters")
    var me by mutableStateOf(obj())
    var settings by mutableStateOf(defaultSettings)
    var characters by mutableStateOf(emptyList<JsonObject>())
    var campaigns by mutableStateOf(emptyList<JsonObject>())
    var sessions by mutableStateOf(emptyList<JsonObject>())
    var campaignId by mutableStateOf("")
    var selectedCharacter by mutableStateOf<JsonObject?>(null)
    var rules by mutableStateOf<RulesData?>(null)
    var provider by mutableStateOf("server")
    var apiKey by mutableStateOf("")
    var model by mutableStateOf("")
    var imageModel by mutableStateOf("")
    var rollHistory by mutableStateOf(emptyList<String>())
    val userId
        get() = (me["user"] as? JsonObject)?.text("id") ?: ""

    val campaign
        get() = campaigns.find { it.text("id") == campaignId }

    fun can(permission: String) =
        campaign?.let { it.text("owner_id") == userId || permission in it.strings("permissions") }
            ?: false

    fun run(block: suspend () -> Unit) {
        if (busy) return
        scope.launch {
            busy = true
            error = ""
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: "Не удалось выполнить действие"
            } finally {
                busy = false
            }
        }
    }

    suspend fun refresh() {
        me = repo.call("me").jsonObject
        settings = repo.call("settings").jsonObject
        characters = repo.call("characters").jsonArray.map { it.jsonObject }
        campaigns = repo.call("campaigns").jsonArray.map { it.jsonObject }
        sessions = repo.call("sessions").jsonArray.map { it.jsonObject }
        if (campaigns.none { it.text("id") == campaignId })
            campaignId = campaigns.firstOrNull()?.text("id") ?: ""
        connected = true
        login = false
    }

    fun connect(url: String) {
        run {
            val next = RemoteRepository(url, store)
            apiKey = ""
            repo.close()
            repo = next
            store.write("server-url", next.url)
            try {
                refresh()
            } catch (e: Exception) {
                login = true
                throw e
            }
        }
    }

    fun local() {
        run {
            repo.close()
            repo = LocalRepository(store)
            refresh()
        }
    }

    suspend fun saveCharacter(row: JsonObject, c: Character): JsonObject {
        c.validate()
        val result =
            repo
                .call(
                    if (row.text("id").isEmpty()) "characters" else "characters/${row.text("id")}",
                    if (row.text("id").isEmpty()) "POST" else "PUT",
                    if (row.text("id").isEmpty()) codec.encodeToJsonElement(c)
                    else
                        obj(
                            "data" to codec.encodeToJsonElement(c),
                            "revision" to row.number("revision"),
                        ),
                )
                .jsonObject
        selectedCharacter = result
        characters = repo.call("characters").jsonArray.map { it.jsonObject }
        notice = "Лист сохранён"
        return result
    }

    fun log(text: String) {
        rollHistory = (listOf("${now()} · $text") + rollHistory).take(300)
        store.write(
            "roll-history-$userId",
            JsonArray(rollHistory.map { JsonPrimitive(it) }).toString(),
        )
    }

    suspend fun assistant(action: String, prompt: String, extra: JsonObject = obj()): JsonObject =
        repo
            .call(
                "assistant",
                "POST",
                obj(
                        "action" to action,
                        "prompt" to prompt,
                        "provider" to provider,
                        "apiKey" to apiKey,
                        "model" to if (action in listOf("portrait", "map")) imageModel else model,
                        "edition" to "srd-2024",
                        "campaignId" to campaignId,
                    )
                    .changed(*extra.map { it.key to it.value }.toTypedArray()),
            )
            .jsonObject
}

@Composable
fun NeustroyApp(actions: DeviceActions) {
    val scope = rememberCoroutineScope()
    val state = remember { AppState(DeviceStore(), actions, scope) }
    LaunchedEffect(Unit) {
        try {
            val parsed =
                withContext(Dispatchers.Default) {
                    suspend fun rows(name: String) =
                        codec
                            .parseToJsonElement(Res.readBytes("files/$name.json").decodeToString())
                            .jsonArray
                            .map { it.jsonObject }
                    RulesData(
                        rows("classes"),
                        rows("spells"),
                        codec
                            .parseToJsonElement(
                                Res.readBytes("files/catalog.json").decodeToString()
                            )
                            .jsonObject
                            .rows("entries"),
                    )
                }
            state.rules = parsed
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            state.error = "Библиотека не загрузилась: ${e.message}"
        }
    }
    MaterialTheme(colorScheme = Night) {
        Surface(Modifier.fillMaxSize(), color = Night.background) {
            if (!state.connected) ConnectScreen(state) else MainScreen(state)
        }
    }
}

@Composable
fun D8(modifier: Modifier = Modifier.size(46.dp)) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        fun face(color: Color, vararg p: Pair<Float, Float>) {
            val path = Path()
            path.moveTo(p[0].first * w, p[0].second * h)
            p.drop(1).forEach { path.lineTo(it.first * w, it.second * h) }
            path.close()
            drawPath(path, color)
        }
        face(Color(0xff4678ff), .5f to .03f, .94f to .42f, .5f to .54f)
        face(Color(0xff75a0ff), .5f to .03f, .06f to .42f, .5f to .54f)
        face(Color(0xff173caa), .06f to .42f, .5f to .54f, .5f to .97f)
        face(Color(0xff0d276b), .94f to .42f, .5f to .54f, .5f to .97f)
    }
}

@Composable
fun PageColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
            .widthIn(max = 900.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
fun Panel(title: String = "", content: @Composable ColumnScope.() -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (title.isNotEmpty())
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    fontFamily = FontFamily.Serif,
                    color = Gold,
                )
            content()
        }
    }
}

@Composable
fun Input(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    multiline: Boolean = false,
    password: Boolean = false,
) {
    if (password)
        OutlinedTextField(
            value,
            onChange,
            label = { Text(label) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
        )
    else
        OutlinedTextField(
            value,
            onChange,
            label = { Text(label) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = !multiline,
            minLines = if (multiline) 3 else 1,
        )
}

@Composable
fun Choice(label: String, value: String, options: Map<String, String>, choose: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Text("$label: ${options[value]?:value}")
        }
        DropdownMenu(open, { open = false }) {
            options.forEach { (key, name) ->
                DropdownMenuItem(
                    text = { Text(name) },
                    onClick = {
                        choose(key)
                        open = false
                    },
                )
            }
        }
    }
}

@Composable
fun Toggle(label: String, value: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(value, change)
        Text(label, Modifier.weight(1f))
    }
}

@Composable
fun Action(label: String, enabled: Boolean = true, click: () -> Unit) {
    Button(onClick = click, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text(label) }
}

@Composable
fun Message(state: AppState) {
    if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (state.error.isNotEmpty())
        Panel("Не получилось") {
            Text(state.error, color = MaterialTheme.colorScheme.error)
            TextButton({ state.error = "" }) { Text("Закрыть") }
        }
    if (state.notice.isNotEmpty())
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(state.notice, Modifier.weight(1f))
            TextButton({ state.notice = "" }) { Text("OK") }
        }
}

@Composable
fun ConnectScreen(s: AppState) {
    var url by remember { mutableStateOf(s.store.read("server-url") ?: "") }
    var mode by remember { mutableStateOf("login") }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    PageColumn {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            D8()
            Text(
                "neustroy",
                style = MaterialTheme.typography.headlineMedium,
                fontFamily = FontFamily.Serif,
            )
        }
        Text("Игровой стол", style = MaterialTheme.typography.titleLarge)
        Message(s)
        Panel("Без аккаунта") {
            Text("Листы, правила и записи хранятся на этом устройстве.")
            Action("Начать локально", !s.busy) { s.local() }
        }
        Panel("Сервер кампании") {
            Input("HTTPS-адрес сервера или IP в вашей сети", url, { url = it })
            Text(
                "Для общей партии запустите сервер на компьютере: npm run lan. Телефон и компьютер должны быть в одной сети.",
                style = MaterialTheme.typography.bodySmall,
            )
            Action("Подключиться", !s.busy && url.isNotBlank()) { s.connect(url) }
        }
        if (s.login)
            Panel("Вход в аккаунт") {
                Choice(
                    "Способ",
                    mode,
                    mapOf(
                        "login" to "Email и пароль",
                        "register" to "Регистрация",
                        "code" to "Код от агента ChatGPT",
                        "forgot-password" to "Забыли пароль",
                        "reset-password" to "Сменить по коду из письма",
                    ),
                ) {
                    mode = it
                }
                if (mode == "code") {
                    Text(
                        "В подключённом к neustroy чате попросите агента выдать код входа в мобильное приложение. Возможности агента остаются доступны в вашем чате."
                    )
                    Input("Код подключения", code, { code = it }, password = true)
                    Action("Войти по коду", !s.busy) {
                        s.run {
                            (s.repo as RemoteRepository).token = code.trim()
                            s.refresh()
                        }
                    }
                } else {
                    if (mode == "register") Input("Имя", name, { name = it })
                    if (mode != "reset-password") Input("Email", email, { email = it })
                    else Input("Код из письма", code, { code = it })
                    if (mode != "forgot-password")
                        Input(
                            "Пароль · от 12 символов",
                            password,
                            { password = it },
                            password = true,
                        )
                    Action("Продолжить", !s.busy) {
                        s.run {
                            val r =
                                s.repo
                                    .call(
                                        "auth/$mode",
                                        "POST",
                                        obj(
                                            "email" to email,
                                            "password" to password,
                                            "name" to name,
                                            "token" to code,
                                        ),
                                    )
                                    .jsonObject
                            password = ""
                            if (mode in listOf("login", "register")) {
                                (s.repo as RemoteRepository).token = r.text("token")
                                s.refresh()
                            } else {
                                s.notice =
                                    r.text("message", "Пароль изменён. Войдите с новым паролем.")
                                mode = "login"
                            }
                        }
                    }
                }
            }
    }
}

val pages =
    linkedMapOf(
        "characters" to "Листы",
        "campaigns" to "Партия",
        "calendar" to "Календарь",
        "journal" to "Журнал",
        "rules" to "Правила",
        "chat" to "Чаты",
        "assistant" to "Помощники",
        "builder" to "Заказать игру",
        "modules" to "Инструменты",
        "settings" to "Настройки",
    )

@Composable
fun MainScreen(s: AppState) {
    var menu by remember { mutableStateOf(false) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            if (s.selectedCharacter != null) "Лист персонажа"
                            else pages[s.page] ?: "neustroy",
                            fontFamily = FontFamily.Serif,
                        )
                        Text(
                            if (s.repo.offline) "На этом устройстве"
                            else (s.repo as? RemoteRepository)?.url ?: "",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                },
                navigationIcon = { TextButton({ menu = true }) { Text("☰") } },
                actions = { TextButton({ s.run { s.refresh() } }) { Text("↻") } },
            )
        },
        bottomBar = {
            NavigationBar {
                listOf("characters", "campaigns", "calendar", "journal", "rules").forEach { page ->
                    NavigationBarItem(
                        selected = s.page == page,
                        onClick = {
                            s.page = page
                            s.selectedCharacter = null
                        },
                        icon = {
                            Text(
                                when (page) {
                                    "characters" -> "◆"
                                    "campaigns" -> "⚑"
                                    "calendar" -> "▦"
                                    "journal" -> "▤"
                                    else -> "✧"
                                }
                            )
                        },
                        label = { Text(pages.getValue(page)) },
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            if (menu)
                DropdownMenu(true, { menu = false }) {
                    pages.forEach { (id, label) ->
                        DropdownMenuItem(
                            text = { Text(label) },
                            onClick = {
                                s.page = id
                                s.selectedCharacter = null
                                menu = false
                            },
                        )
                    }
                }
            if (s.selectedCharacter != null) CharacterScreen(s, s.selectedCharacter!!)
            else
                when (s.page) {
                    "characters" -> CharacterList(s)
                    "campaigns" -> CampaignScreen(s)
                    "calendar" -> CalendarScreen(s)
                    "journal" -> JournalScreen(s)
                    "rules" -> RulesScreen(s)
                    "chat" -> ChatScreen(s)
                    "assistant" -> AssistantScreen(s)
                    "builder" -> BuilderScreen(s)
                    "modules" -> ModulesScreen(s)
                    else -> SettingsScreen(s)
                }
        }
    }
}

@Composable
fun CampaignChoice(s: AppState) {
    Choice("Игра", s.campaignId, s.campaigns.associate { it.text("id") to it.text("name") }) {
        s.campaignId = it
    }
}
