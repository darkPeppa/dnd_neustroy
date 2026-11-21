@file:OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)

package ru.neustroy

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Composable
fun CharacterList(s: AppState) {
    var preview by remember { mutableStateOf<Character?>(null) }
    PageColumn {
        Message(s)
        Action("Создать персонажа", !s.busy) {
            s.selectedCharacter =
                obj("id" to "", "revision" to 0, "data" to codec.encodeToJsonElement(Character()))
        }
        OutlinedButton(
            onClick = {
                s.actions.importFile { file ->
                    if (file != null && !s.agentEnabled && !file.name.endsWith(".json", true))
                        s.error = "При выключенном помощнике доступен импорт JSON"
                    else if (file != null && file.mime.startsWith("image/"))
                        s.run {
                            val response =
                                s.assistant(
                                    "parse-character",
                                    "Распознай лист персонажа и отметь неизвестные поля в notes.",
                                    obj(
                                        "image" to
                                            obj(
                                                "mime" to file.mime,
                                                "base64" to
                                                    kotlin.io.encoding.Base64.encode(file.bytes),
                                            )
                                    ),
                                )
                            preview =
                                codec
                                    .decodeFromJsonElement<Character>(
                                        response.getValue("character")
                                    )
                                    .validate()
                        }
                    else if (file != null)
                        s.actions.extractText(file) { text, error ->
                            if (error != null) s.error = error
                            else if (text != null)
                                s.run {
                                    val parsed =
                                        runCatching {
                                                val value = codec.parseToJsonElement(text)
                                                codec
                                                    .decodeFromJsonElement<Character>(
                                                        (value as? JsonObject)?.get("data") ?: value
                                                    )
                                                    .validate()
                                            }
                                            .getOrNull()
                                    preview =
                                        parsed
                                            ?: codec
                                                .decodeFromJsonElement<Character>(
                                                    s.assistant("parse-character", text)
                                                        .getValue("character")
                                                )
                                                .validate()
                                }
                        }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (s.agentEnabled) "Импорт листа · JSON / PDF / фото" else "Импорт листа · JSON")
        }
        if (preview != null)
            Panel("Проверка распознанного листа") {
                Text("${preview!!.name} · ${preview!!.info.name} · уровень ${preview!!.level}")
                Text(
                    "${editions[preview!!.edition]} · Хиты ${preview!!.hp}/${preview!!.maxHp} · КД ${preview!!.ac}"
                )
                Text(
                    preview!!.scores.entries.joinToString(" · ") {
                        "${statLabels[it.key]} ${it.value}"
                    }
                )
                Text("Проверьте поля в редакторе. Импорт пока ничего не записывает в аккаунт.")
                Action("Открыть для проверки") {
                    s.selectedCharacter =
                        obj(
                            "id" to "",
                            "revision" to 0,
                            "data" to codec.encodeToJsonElement(preview!!),
                        )
                    preview = null
                }
                TextButton({ preview = null }) { Text("Отмена") }
            }
        if (s.characters.isEmpty())
            Text("Пока нет листов. Создайте героя или импортируйте готовый.")
        s.characters.forEach { row ->
            val c = codec.decodeFromJsonElement<Character>(row.getValue("data"))
            OutlinedCard(
                onClick = { s.selectedCharacter = row },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(
                        c.name,
                        style = MaterialTheme.typography.titleLarge,
                        fontFamily = FontFamily.Serif,
                    )
                    Text("${c.info.name} ${c.level} · ${editions[c.edition]}")
                    Text(
                        "Хиты ${c.hp}/${c.maxHp}   КД ${c.ac}   Владение ${signed(c.proficiency)}",
                        color = Gold,
                    )
                }
            }
        }
    }
}

@Composable
fun CharacterScreen(s: AppState, row: JsonObject) {
    val id = row.text("id")
    val draftKey = "sheet-draft-${s.userId}-$id"
    var c by
        remember(id) {
            mutableStateOf(
                runCatching {
                        s.store.read(draftKey)?.let { codec.decodeFromString<Character>(it) }
                    }
                    .getOrNull() ?: codec.decodeFromJsonElement<Character>(row.getValue("data"))
            )
        }
    var tab by remember { mutableStateOf("sheet") }
    var result by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf("normal") }
    var selectedSpell by remember(id) { mutableStateOf("") }
    var circle by remember { mutableStateOf("1") }
    var spellQuery by remember { mutableStateOf("") }
    var customName by remember { mutableStateOf("") }
    var customText by remember { mutableStateOf("") }
    var customLevel by remember { mutableStateOf("1") }
    var customDice by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf(false) }
    LaunchedEffect(c) {
        try {
            s.store.write(draftKey, codec.encodeToString(c))
        } catch (e: Exception) {
            s.error = "Черновик не сохранён: ${e.message}"
        }
    }
    val colors =
        when (c.theme) {
            "standard" ->
                lightColorScheme(
                    primary = Color(0xff4c4740),
                    background = Color(0xffeee7d7),
                    surface = Color(0xfff6f1e6),
                )
            "festival" ->
                lightColorScheme(
                    primary = Color(0xff7a4e29),
                    background = Color(0xffe9d8bb),
                    surface = Color(0xfff2e6cf),
                )
            "horror" ->
                darkColorScheme(
                    primary = Color(0xffdc8791),
                    background = Color(0xff1b1117),
                    surface = Color(0xff291c26),
                )
            "winter" ->
                darkColorScheme(
                    primary = Color(0xffa8d6c3),
                    background = Color(0xff10251f),
                    surface = Color(0xff1a332c),
                )
            else -> Night
        }
    MaterialTheme(colorScheme = colors) {
        Surface(color = colors.background) {
            PageColumn {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton({ s.selectedCharacter = null }) { Text("‹ Все листы") }
                    Button(
                        {
                            s.run {
                                s.saveCharacter(row, c)
                                s.store.write(draftKey, null)
                            }
                        },
                        enabled = !s.busy,
                    ) {
                        Text("Сохранить")
                    }
                }
                Message(s)
                Text(
                    c.name,
                    style = MaterialTheme.typography.headlineMedium,
                    fontFamily = FontFamily.Serif,
                )
                Text("${c.info.name} · ${c.level} ур. · КД ${c.ac} · Хиты ${c.hp}/${c.maxHp}")
                Action("Экспорт листа в PDF") { s.actions.exportPdf(c.name, characterText(c)) }
                Choice(
                    "Раздел",
                    tab,
                    linkedMapOf(
                        "sheet" to "Характеристики",
                        "combat" to "За столом",
                        "spells" to "Заклинания",
                        "features" to "Умения",
                        "inventory" to "Снаряжение",
                        "notes" to "История и заметки",
                        "custom" to "Домашние правила",
                        "appearance" to "Оформление и портрет",
                    ),
                ) {
                    tab = it
                }
                when (tab) {
                    "sheet" -> {
                        Input("Имя", c.name, { c = c.copy(name = it.take(80)) })
                        Choice("Редакция", c.edition, editions) {
                            c =
                                c.copy(
                                    edition = it,
                                    subclass = "",
                                    prepared = emptyList(),
                                    spentSlots = emptyMap(),
                                )
                            selectedSpell = ""
                        }
                        if (c.edition == "custom")
                            Choice(
                                "Базовая редакция",
                                c.rulesBase,
                                editions.filterKeys { it != "custom" },
                            ) {
                                c =
                                    c.copy(
                                        rulesBase = it,
                                        subclass = "",
                                        prepared = emptyList(),
                                        spentSlots = emptyMap(),
                                    )
                            }
                        Choice("Класс", c.classId, classes.mapValues { it.value.name }) {
                            c =
                                c.copy(
                                    classId = it,
                                    subclass = "",
                                    prepared = emptyList(),
                                    spentSlots = emptyMap(),
                                )
                            selectedSpell = ""
                        }
                        Choice(
                            "Уровень",
                            c.level.toString(),
                            (1..20).associate { it.toString() to it.toString() },
                        ) {
                            c = c.copy(level = it.toInt(), spentSlots = emptyMap())
                        }
                        val subs = s.rules?.subclasses(c) ?: emptyList()
                        Choice(
                            "Подкласс",
                            c.subclass,
                            mapOf("" to "Не выбран") +
                                subs.associate { it.text("key") to it.text("name") },
                        ) {
                            c = c.copy(subclass = it)
                        }
                        Input(
                            "Вид / происхождение",
                            c.ancestry,
                            { c = c.copy(ancestry = it.take(80)) },
                        )
                        Input(
                            "Предыстория",
                            c.background,
                            { c = c.copy(background = it.take(100)) },
                        )
                        statLabels.forEach { (key, label) ->
                            NumberInput(
                                "$label · мод. ${signed(c.modifier(key))}",
                                (c.scores[key] ?: 10).toDouble(),
                                3.0,
                                20.0,
                                true,
                            ) {
                                c = c.copy(scores = c.scores + (key to it.toInt()))
                            }
                        }
                        Panel("Навыки") {
                            skills.forEach { (key, skill) ->
                                Toggle(
                                    "${skill.first} ${signed(c.skillBonus(key))}",
                                    key in c.proficientSkills,
                                ) { checked ->
                                    c =
                                        c.copy(
                                            proficientSkills =
                                                if (checked) c.proficientSkills + key
                                                else c.proficientSkills - key,
                                            expertise =
                                                if (checked) c.expertise else c.expertise - key,
                                        )
                                }
                                if (key in c.proficientSkills)
                                    Toggle("Экспертиза: ${skill.first}", key in c.expertise) {
                                        checked ->
                                        c =
                                            c.copy(
                                                expertise =
                                                    if (checked) c.expertise + key
                                                    else c.expertise - key
                                            )
                                    }
                            }
                        }
                    }
                    "combat" -> {
                        Input(
                            "Текущие хиты",
                            c.hp.toString(),
                            { it.toIntOrNull()?.let { n -> c = c.copy(hp = n.coerceIn(0, 1000)) } },
                        )
                        Input(
                            "Временные хиты",
                            c.tempHp.toString(),
                            {
                                it.toIntOrNull()?.let { n ->
                                    c = c.copy(tempHp = n.coerceIn(0, 1000))
                                }
                            },
                        )
                        Text(
                            "Максимум хитов ${c.maxHp} · Инициатива ${signed(c.modifier("dex"))} · Владение ${signed(c.proficiency)}"
                        )
                        Choice(
                            "Доспех",
                            c.armor,
                            mapOf(
                                "none" to "Без доспеха",
                                "leather" to "Кожаный",
                                "chain" to "Кольчуга",
                                "plate" to "Латы",
                            ),
                        ) {
                            c = c.copy(armor = it)
                        }
                        Toggle("Щит (+2 КД)", c.shield) { c = c.copy(shield = it) }
                        Choice(
                            "Бросок",
                            mode,
                            mapOf(
                                "normal" to "Обычный",
                                "advantage" to "Преимущество",
                                "disadvantage" to "Помеха",
                            ),
                        ) {
                            mode = it
                        }
                        statLabels.forEach { (key, label) ->
                            OutlinedButton(
                                onClick = {
                                    val bonus =
                                        c.modifier(key) +
                                            if (key in c.info.saves) c.proficiency else 0
                                    val r = check(bonus, mode)
                                    result = "$label: ${r.total} [${r.dice.joinToString()}]"
                                    s.log("${c.name} · $result")
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    "Спасбросок $label ${signed(c.modifier(key)+if(key in c.info.saves)c.proficiency else 0)}"
                                )
                            }
                        }
                        skills.forEach { (key, skill) ->
                            OutlinedButton(
                                onClick = {
                                    val r = check(c.skillBonus(key), mode)
                                    result = "${skill.first}: ${r.total} [${r.dice.joinToString()}]"
                                    s.log("${c.name} · $result")
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("${skill.first} ${signed(c.skillBonus(key))}")
                            }
                        }
                        if (result.isNotEmpty()) Panel("Бросок") { Text(result) }
                        Action("Продолжительный отдых") {
                            c = c.copy(hp = c.maxHp, tempHp = 0, spentSlots = emptyMap())
                            result =
                                "Хиты и ячейки восстановлены. Остальные ресурсы — в снаряжении."
                        }
                        if (c.info.caster == "pact")
                            Action("Короткий отдых · восстановить магию договора") {
                                c = c.copy(spentSlots = emptyMap())
                            }
                    }
                    "spells" -> {
                        Text("Атака ${signed(c.proficiency+c.spellModifier)} · Сл ${c.dc}")
                        c.slots().forEachIndexed { index, max ->
                            if (max > 0)
                                Text(
                                    "Круг ${index+1}: ${(max-c.spentSlots.getOrElse((index+1).toString()){0}).coerceAtLeast(0)} / $max"
                                )
                        }
                        Input("Поиск заклинания", spellQuery, { spellQuery = it })
                        val available =
                            s.rules?.spells(c)?.filter {
                                it.text("name").contains(spellQuery, true)
                            } ?: emptyList()
                        Choice(
                            "Доступное заклинание",
                            selectedSpell,
                            mapOf("" to "Выберите") +
                                available.associate {
                                    it.text("id") to "${it.number("level")} · ${it.text("name")}"
                                },
                        ) {
                            selectedSpell = it
                        }
                        val spell = s.rules?.spells(c)?.find { it.text("id") == selectedSpell }
                        if (spell != null)
                            Panel(spell.text("name")) {
                                Text(spell.text("desc"))
                                if (spell.text("higher_level").isNotEmpty())
                                    Text(spell.text("higher_level"))
                                if (spell.number("level") > 0) {
                                    Toggle("Подготовлено", selectedSpell in c.prepared) { v ->
                                        c =
                                            c.copy(
                                                prepared =
                                                    if (v) (c.prepared + selectedSpell).distinct()
                                                    else c.prepared - selectedSpell
                                            )
                                    }
                                    Choice(
                                        "Ячейка",
                                        circle,
                                        c.slots()
                                            .mapIndexedNotNull { i, max ->
                                                if (max > 0 && i + 1 >= spell.number("level"))
                                                    (i + 1).toString() to "${i+1} круг"
                                                else null
                                            }
                                            .toMap(),
                                    ) {
                                        circle = it
                                    }
                                }
                                Choice(
                                    "Атака",
                                    mode,
                                    mapOf(
                                        "normal" to "Обычный бросок",
                                        "advantage" to "Преимущество",
                                        "disadvantage" to "Помеха",
                                    ),
                                ) {
                                    mode = it
                                }
                                Action("Сотворить", !s.busy) {
                                    s.run {
                                        val cast =
                                            cast(
                                                c,
                                                spell,
                                                if (spell.number("level") == 0) 0
                                                else circle.toInt(),
                                                mode,
                                            )
                                        s.saveCharacter(row, cast.character)
                                        c = cast.character
                                        result = cast.text
                                        s.log("${c.name} · ${spell.text("name")} · $result")
                                    }
                                }
                            }
                        if (result.isNotEmpty()) Panel("Результат") { Text(result) }
                        Text(
                            "Подтверждение попадания, сопротивления и сложные эффекты определяет мастер.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    "features" -> {
                        (s.rules?.features(c) ?: emptyList()).forEach {
                            Panel("${it.name} · ${it.level} ур.") { Text(it.text) }
                        }
                        Input(
                            "Черты · каждая с новой строки",
                            c.feats.joinToString("\n"),
                            { c = c.copy(feats = it.lines().filter { it.isNotBlank() }.take(50)) },
                            true,
                        )
                    }
                    "inventory" ->
                        Input(
                            "Снаряжение и ресурсы",
                            c.inventory,
                            { c = c.copy(inventory = it.take(12000)) },
                            true,
                        )
                    "notes" -> {
                        Input(
                            "История и личные заметки",
                            c.notes,
                            { c = c.copy(notes = it.take(12000)) },
                            true,
                        )
                        Action("Продиктовать") {
                            s.actions.dictate {
                                if (it != null)
                                    c = c.copy(notes = (c.notes + "\n" + it).take(12000))
                            }
                        }
                    }
                    "appearance" -> {
                        Choice("Оформление листа", c.theme, themes) { c = c.copy(theme = it) }
                        PortraitPanel(s, id)
                        Text(
                            "Структура классического листа: характеристики, навыки и бой отдельно от заклинаний. Оформление меняет вид листа, сохраняя его данные."
                        )
                        TextButton({
                            s.actions.openUrl(
                                "https://www.dndbeyond.com/resources/1779-d-d-character-sheets"
                            )
                        }) {
                            Text("Официальные варианты листов 2014 / 2024")
                        }
                    }
                    "custom" -> {
                        if (c.classId == "custom")
                            Panel("Свой класс") {
                                Input(
                                    "Название",
                                    c.customClass.name,
                                    {
                                        c =
                                            c.copy(
                                                customClass = c.customClass.copy(name = it.take(80))
                                            )
                                    },
                                )
                                Choice(
                                    "Кость хитов",
                                    c.customClass.hitDie.toString(),
                                    listOf(4, 6, 8, 10, 12, 20).associate {
                                        it.toString() to "d$it"
                                    },
                                ) {
                                    c =
                                        c.copy(
                                            customClass = c.customClass.copy(hitDie = it.toInt())
                                        )
                                }
                                Choice(
                                    "Заклинательная характеристика",
                                    c.customClass.ability,
                                    statLabels,
                                ) {
                                    c = c.copy(customClass = c.customClass.copy(ability = it))
                                }
                                Choice(
                                    "Магия",
                                    c.customClass.caster,
                                    mapOf(
                                        "none" to "Нет",
                                        "full" to "Полная",
                                        "half" to "Половинная",
                                        "pact" to "Договор",
                                    ),
                                ) {
                                    c = c.copy(customClass = c.customClass.copy(caster = it))
                                }
                            }
                        Input(
                            "Название умения / заклинания",
                            customName,
                            { customName = it.take(120) },
                        )
                        Input("Уровень умения / круг заклинания", customLevel, { customLevel = it })
                        Input("Описание", customText, { customText = it.take(12000) }, true)
                        Input(
                            "Кубики для своего заклинания, например 2d6",
                            customDice,
                            { customDice = it },
                        )
                        Action("Добавить умение") {
                            if (customName.isNotBlank()) {
                                c =
                                    c.copy(
                                        customFeatures =
                                            c.customFeatures +
                                                CustomFeature(
                                                    name = customName,
                                                    level =
                                                        (customLevel.toIntOrNull() ?: 1).coerceIn(
                                                            1,
                                                            20,
                                                        ),
                                                    text = customText,
                                                )
                                    )
                                customName = ""
                                customText = ""
                            }
                        }
                        Action("Добавить заклинание") {
                            if (customName.isNotBlank()) {
                                c =
                                    c.copy(
                                        customSpells =
                                            c.customSpells +
                                                CustomSpell(
                                                    name = customName,
                                                    level =
                                                        (customLevel.toIntOrNull() ?: 0).coerceIn(
                                                            0,
                                                            9,
                                                        ),
                                                    kind =
                                                        if (customDice.isBlank()) "utility"
                                                        else "auto",
                                                    dice = customDice.takeIf { it.isNotBlank() },
                                                    text = customText,
                                                )
                                    )
                                customName = ""
                                customText = ""
                            }
                        }
                        c.customFeatures.forEach { f ->
                            Row {
                                Text(f.name, Modifier.weight(1f))
                                TextButton({
                                    c =
                                        c.copy(
                                            customFeatures =
                                                c.customFeatures.filter { it.id != f.id }
                                        )
                                }) {
                                    Text("Удалить")
                                }
                            }
                        }
                        c.customSpells.forEach { f ->
                            Row {
                                Text(f.name, Modifier.weight(1f))
                                TextButton({
                                    c =
                                        c.copy(
                                            customSpells = c.customSpells.filter { it.id != f.id },
                                            prepared = c.prepared - f.id,
                                        )
                                }) {
                                    Text("Удалить")
                                }
                            }
                        }
                        var packs by remember { mutableStateOf(emptyList<JsonObject>()) }
                        Action("Мои пакеты правил") {
                            s.run {
                                packs = s.repo.call("rule-packs").jsonArray.map { it.jsonObject }
                            }
                        }
                        packs.forEach { p ->
                            Action("Применить ${p.text("name")}") {
                                c =
                                    c.copy(
                                        customSpells =
                                            (c.customSpells +
                                                    codec.decodeFromJsonElement<List<CustomSpell>>(
                                                        p.getValue("spells")
                                                    ))
                                                .distinctBy { it.id },
                                        customFeatures =
                                            (c.customFeatures +
                                                    codec.decodeFromJsonElement<
                                                        List<CustomFeature>
                                                    >(
                                                        p.getValue("features")
                                                    ))
                                                .distinctBy { it.id },
                                    )
                            }
                        }
                    }
                }
                OutlinedButton(
                    onClick = {
                        s.actions.exportFile(
                            MobileFile(
                                "${c.name}.json",
                                "application/json",
                                codec.encodeToString(c).encodeToByteArray(),
                            )
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Экспорт листа · JSON")
                }
                if (id.isNotEmpty())
                    TextButton({ confirmDelete = true }) {
                        Text("Удалить персонажа", color = MaterialTheme.colorScheme.error)
                    }
                if (confirmDelete)
                    AlertDialog(
                        onDismissRequest = { confirmDelete = false },
                        title = { Text("Удалить ${c.name}?") },
                        text = {
                            Text("Сначала можно экспортировать лист. Удаление нельзя отменить.")
                        },
                        confirmButton = {
                            TextButton({
                                s.run {
                                    s.repo.call("characters/$id", "DELETE")
                                    s.selectedCharacter = null
                                    s.refresh()
                                }
                                confirmDelete = false
                            }) {
                                Text("Удалить")
                            }
                        },
                        dismissButton = { TextButton({ confirmDelete = false }) { Text("Отмена") } },
                    )
            }
        }
    }
}
