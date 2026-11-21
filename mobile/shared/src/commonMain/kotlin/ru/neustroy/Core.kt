package ru.neustroy

import kotlin.math.floor
import kotlinx.datetime.Clock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

val codec = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

fun JsonObject.text(key: String, fallback: String = "") =
    (get(key) as? JsonPrimitive)?.contentOrNull ?: fallback

fun JsonObject.number(key: String, fallback: Int = 0) =
    (get(key) as? JsonPrimitive)?.let {
        it.intOrNull
            ?: it.doubleOrNull
                ?.takeIf { n ->
                    n.isFinite() && n in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble()
                }
                ?.toInt()
    } ?: fallback

fun JsonObject.flag(key: String) =
    (get(key) as? JsonPrimitive)?.let { it.booleanOrNull ?: (it.intOrNull == 1) } ?: false

fun JsonObject.rows(key: String) =
    (get(key) as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

fun JsonObject.strings(key: String) =
    (get(key) as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()

fun element(v: Any?): JsonElement =
    when (v) {
        null -> JsonNull
        is JsonElement -> v
        is String -> JsonPrimitive(v)
        is Boolean -> JsonPrimitive(v)
        is Number -> JsonPrimitive(v)
        is List<*> -> JsonArray(v.map(::element))
        is Map<*, *> -> JsonObject(v.entries.associate { it.key.toString() to element(it.value) })
        else -> error("Unsupported JSON value")
    }

fun obj(vararg values: Pair<String, Any?>) =
    JsonObject(values.associate { it.first to element(it.second) })

fun JsonObject.changed(vararg values: Pair<String, Any?>) = JsonObject(this + obj(*values))

fun now() = Clock.System.now().toString()

fun newId() = (1..16).joinToString("") { secureInt(256).toString(16).padStart(2, '0') }

expect fun secureInt(bound: Int): Int

interface Storage {
    fun read(key: String): String?

    fun write(key: String, value: String?)
}

expect class DeviceStore() : Storage {
    override fun read(key: String): String?

    override fun write(key: String, value: String?)
}

data class MobileFile(val name: String, val mime: String, val bytes: ByteArray)

interface DeviceActions {
    fun exportFile(file: MobileFile)

    fun importFile(done: (MobileFile?) -> Unit)

    fun dictate(done: (String?) -> Unit)

    fun openUrl(url: String)

    fun remind(id: String, title: String, start: String, done: (String?) -> Unit)

    fun extractText(file: MobileFile, done: (String?, String?) -> Unit) {
        done(file.bytes.decodeToString(), null)
    }

    fun playAudio(url: String, volume: Float, loop: Boolean) {
        openUrl(url)
    }

    fun stopAudio() {}

    fun speak(text: String) {}
}

object ConnectionPolicy {
    fun normalize(raw: String): String {
        val value = raw.trim().trimEnd('/')
        val m =
            Regex("^(https?)://([a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?$").matchEntire(value)
                ?: error(
                    "Укажите адрес вида https://example.ru или http://192.168.1.5:8787, без пути и пароля"
                )
        val port = m.groupValues[3].toIntOrNull()
        require(port == null || port in 1..65535) { "Неверный порт" }
        val host = m.groupValues[2].lowercase()
        require(
            host.split('.').all { it.isNotEmpty() && !it.startsWith('-') && !it.endsWith('-') }
        ) {
            "Неверное имя сервера"
        }
        require(m.groupValues[1] == "https" || isPrivate(host)) {
            "Для внешнего сервера нужен HTTPS. HTTP разрешён только в локальной сети."
        }
        return "${m.groupValues[1]}://$host" + if (port == null) "" else ":$port"
    }

    fun isPrivate(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".local")) return true
        val labels = host.split('.')
        if (labels.size != 4) return false
        val p =
            labels.map { label ->
                val n = label.toIntOrNull() ?: return false
                if (n.toString() != label) return false
                n
            }
        return p.all { it in 0..255 } &&
            (p[0] == 10 ||
                p[0] == 127 ||
                (p[0] == 192 && p[1] == 168) ||
                (p[0] == 172 && p[1] in 16..31))
    }
}

val statLabels =
    linkedMapOf(
        "str" to "Сила",
        "dex" to "Ловкость",
        "con" to "Телосложение",
        "int" to "Интеллект",
        "wis" to "Мудрость",
        "cha" to "Харизма",
    )

data class ClassDef(
    val name: String,
    val hitDie: Int,
    val ability: String,
    val caster: String,
    val saves: List<String>,
)

val classes =
    linkedMapOf(
        "barbarian" to ClassDef("Варвар", 12, "str", "none", listOf("str", "con")),
        "bard" to ClassDef("Бард", 8, "cha", "full", listOf("dex", "cha")),
        "cleric" to ClassDef("Жрец", 8, "wis", "full", listOf("wis", "cha")),
        "druid" to ClassDef("Друид", 8, "wis", "full", listOf("int", "wis")),
        "fighter" to ClassDef("Воин", 10, "str", "none", listOf("str", "con")),
        "monk" to ClassDef("Монах", 8, "wis", "none", listOf("str", "dex")),
        "paladin" to ClassDef("Паладин", 10, "cha", "half", listOf("wis", "cha")),
        "ranger" to ClassDef("Следопыт", 10, "wis", "half", listOf("str", "dex")),
        "rogue" to ClassDef("Плут", 8, "dex", "none", listOf("dex", "int")),
        "sorcerer" to ClassDef("Чародей", 6, "cha", "full", listOf("con", "cha")),
        "warlock" to ClassDef("Колдун", 8, "cha", "pact", listOf("wis", "cha")),
        "wizard" to ClassDef("Волшебник", 6, "int", "full", listOf("int", "wis")),
        "custom" to ClassDef("Свой класс", 8, "int", "none", emptyList()),
    )
val skills =
    linkedMapOf(
        "athletics" to ("Атлетика" to "str"),
        "acrobatics" to ("Акробатика" to "dex"),
        "sleight" to ("Ловкость рук" to "dex"),
        "stealth" to ("Скрытность" to "dex"),
        "arcana" to ("Магия" to "int"),
        "history" to ("История" to "int"),
        "investigation" to ("Расследование" to "int"),
        "nature" to ("Природа" to "int"),
        "religion" to ("Религия" to "int"),
        "animal" to ("Уход за животными" to "wis"),
        "insight" to ("Проницательность" to "wis"),
        "medicine" to ("Медицина" to "wis"),
        "perception" to ("Внимательность" to "wis"),
        "survival" to ("Выживание" to "wis"),
        "deception" to ("Обман" to "cha"),
        "intimidation" to ("Запугивание" to "cha"),
        "performance" to ("Выступление" to "cha"),
        "persuasion" to ("Убеждение" to "cha"),
    )
val editions =
    linkedMapOf(
        "srd-2014" to "D&D 5e · 2014",
        "srd-2024" to "D&D 5e · 2024",
        "custom" to "Свои правила",
    )
val themes =
    linkedMapOf(
        "standard" to "Классический лист",
        "blue" to "Синий к8",
        "festival" to "Таверна",
        "horror" to "Тёмный гримуар",
        "winter" to "Зимний лес",
    )

@Serializable
data class CustomClass(
    val name: String = "Свой класс",
    val hitDie: Int = 8,
    val ability: String = "int",
    val caster: String = "none",
)

@Serializable
data class CustomFeature(
    val id: String = newId(),
    val name: String = "",
    val level: Int = 1,
    val text: String = "",
)

@Serializable
data class CustomSpell(
    val id: String = newId(),
    val name: String = "",
    val level: Int = 0,
    val kind: String = "utility",
    val dice: String? = null,
    val save: String? = null,
    val text: String = "",
)

@Serializable
data class Character(
    val name: String = "Новый герой",
    val classId: String = "wizard",
    val level: Int = 1,
    val ancestry: String = "Человек",
    val background: String = "Странник",
    val scores: Map<String, Int> =
        mapOf("str" to 10, "dex" to 14, "con" to 14, "int" to 16, "wis" to 12, "cha" to 10),
    val proficientSkills: List<String> = emptyList(),
    val expertise: List<String> = emptyList(),
    val hp: Int = 8,
    val tempHp: Int = 0,
    val armor: String = "none",
    val shield: Boolean = false,
    val spentSlots: Map<String, Int> = emptyMap(),
    val prepared: List<String> = emptyList(),
    val notes: String = "",
    val inventory: String = "",
    val feats: List<String> = emptyList(),
    val edition: String = "srd-2014",
    val rulesBase: String = "srd-2014",
    val theme: String = "standard",
    val subclass: String = "",
    val customClass: CustomClass = CustomClass(),
    val customSpells: List<CustomSpell> = emptyList(),
    val customFeatures: List<CustomFeature> = emptyList(),
) {
    val baseEdition
        get() = if (edition == "custom") rulesBase else edition

    val info
        get() =
            if (classId == "custom")
                ClassDef(
                    customClass.name,
                    customClass.hitDie,
                    customClass.ability,
                    customClass.caster,
                    emptyList(),
                )
            else classes[classId] ?: classes.getValue("wizard")

    val proficiency
        get() = 2 + (level - 1) / 4

    fun modifier(stat: String) = floor(((scores[stat] ?: 10) - 10) / 2.0).toInt()

    val maxHp
        get() =
            (info.hitDie + modifier("con")).coerceAtLeast(1) +
                (level - 1) * (info.hitDie / 2 + 1 + modifier("con")).coerceAtLeast(1)

    val ac
        get() =
            (when (armor) {
                "leather" -> 11 + modifier("dex")
                "chain" -> 16
                "plate" -> 18
                else ->
                    10 +
                        modifier("dex") +
                        when {
                            classId == "monk" && !shield -> modifier("wis").coerceAtLeast(0)
                            classId == "barbarian" -> modifier("con").coerceAtLeast(0)
                            else -> 0
                        }
            }) + if (shield) 2 else 0

    val spellModifier
        get() = modifier(info.ability)

    val dc
        get() = 8 + proficiency + spellModifier

    fun skillBonus(key: String) =
        modifier(skills[key]?.second ?: "str") +
            if (key in expertise) proficiency * 2
            else if (key in proficientSkills) proficiency else 0

    fun slots(): List<Int> =
        when (info.caster) {
            "full" -> slotsTable[level]
            "half" ->
                if (baseEdition == "srd-2014" && level == 1) emptyList()
                else slotsTable[(level + 1) / 2]
            "pact" ->
                List(minOf(5, (level + 1) / 2)) {
                    if (it == minOf(5, (level + 1) / 2) - 1)
                        (if (level == 1) 1 else if (level < 11) 2 else if (level < 17) 3 else 4)
                    else 0
                }
            else -> emptyList()
        }

    fun validate(): Character {
        require(name.isNotBlank() && name.length <= 80) { "Имя: от 1 до 80 символов" }
        require(
            classId in classes &&
                level in 1..20 &&
                edition in editions &&
                rulesBase in listOf("srd-2014", "srd-2024")
        ) {
            "Проверьте класс, уровень и редакцию"
        }
        require(statLabels.keys.all { (scores[it] ?: 0) in 3..20 }) { "Характеристики: от 3 до 20" }
        require(
            hp in 0..1000 &&
                tempHp in 0..1000 &&
                armor in listOf("none", "leather", "chain", "plate") &&
                theme in themes
        ) {
            "Проверьте хиты и оформление"
        }
        require(
            notes.length <= 12000 &&
                inventory.length <= 12000 &&
                customSpells.size <= 100 &&
                customFeatures.size <= 100
        ) {
            "Слишком большой лист"
        }
        return this
    }
}

val slotsTable =
    listOf(
        emptyList(),
        listOf(2),
        listOf(3),
        listOf(4, 2),
        listOf(4, 3),
        listOf(4, 3, 2),
        listOf(4, 3, 3),
        listOf(4, 3, 3, 1),
        listOf(4, 3, 3, 2),
        listOf(4, 3, 3, 3, 1),
        listOf(4, 3, 3, 3, 2),
        listOf(4, 3, 3, 3, 2, 1),
        listOf(4, 3, 3, 3, 2, 1),
        listOf(4, 3, 3, 3, 2, 1, 1),
        listOf(4, 3, 3, 3, 2, 1, 1),
        listOf(4, 3, 3, 3, 2, 1, 1, 1),
        listOf(4, 3, 3, 3, 2, 1, 1, 1),
        listOf(4, 3, 3, 3, 2, 1, 1, 1, 1),
        listOf(4, 3, 3, 3, 3, 1, 1, 1, 1),
        listOf(4, 3, 3, 3, 3, 2, 1, 1, 1),
        listOf(4, 3, 3, 3, 3, 2, 2, 1, 1),
    )

data class DiceResult(val formula: String, val dice: List<Int>, val bonus: Int) {
    val total
        get() = dice.sum() + bonus

    override fun toString() = "$total  [${dice.joinToString()}] ${signed(bonus)}"
}

fun signed(n: Int) = if (n >= 0) "+$n" else "$n"

fun roll(formula: String, die: (Int) -> Int = { secureInt(it) + 1 }): DiceResult {
    val m =
        Regex("^(\\d{1,2})d(4|6|8|10|12|20|100)([+-]\\d{1,3})?$")
            .matchEntire(formula.replace(" ", "")) ?: error("Формат: 2d6+3, до 40 кубиков")
    val count = m.groupValues[1].toInt()
    require(count in 1..40) { "От 1 до 40 кубиков" }
    return DiceResult(
        formula,
        List(count) { die(m.groupValues[2].toInt()) },
        m.groupValues[3].toIntOrNull() ?: 0,
    )
}

data class CheckResult(val dice: List<Int>, val natural: Int, val total: Int)

fun check(
    bonus: Int,
    mode: String = "normal",
    die: (Int) -> Int = { secureInt(it) + 1 },
): CheckResult {
    val dice = List(if (mode == "normal") 1 else 2) { die(20) }
    val n = if (mode == "disadvantage") dice.min() else dice.max()
    return CheckResult(dice, n, n + bonus)
}

class RulesData(
    val classRows: List<JsonObject>,
    val spellRows: List<JsonObject>,
    val catalog: List<JsonObject>,
) {
    fun subclasses(c: Character) =
        classRows.filter {
            it["document"]?.jsonObject?.text("key") == c.baseEdition &&
                (it["subclass_of"] as? JsonObject)?.text("key") == "${c.baseEdition}_${c.classId}"
        }

    fun features(c: Character): List<CustomFeature> =
        classRows
            .filter {
                it["document"]?.jsonObject?.text("key") == c.baseEdition &&
                    it.text("key") in listOf("${c.baseEdition}_${c.classId}", c.subclass)
            }
            .flatMap { it.rows("features") }
            .mapNotNull { f ->
                val level = f.rows("gained_at").minOfOrNull { it.number("level", 99) } ?: 99
                if (level <= c.level)
                    CustomFeature(f.text("key"), f.text("name"), level, f.text("desc"))
                else null
            } + c.customFeatures.filter { it.level <= c.level }

    fun spells(c: Character): List<JsonObject> {
        val slots = c.slots()
        val rows =
            spellRows.filter {
                it["document"]?.jsonObject?.text("key") == c.baseEdition &&
                    it.rows("classes").any { cl -> cl.text("name").lowercase() == c.classId } &&
                    if (it.number("level") == 0) c.info.caster in listOf("full", "pact")
                    else slots.getOrElse(it.number("level") - 1) { 0 } > 0
            }
        return rows.map { it.changed("id" to spellId(it.text("key"))) } +
            c.customSpells
                .filter { it.level == 0 || slots.getOrElse(it.level - 1) { 0 } > 0 }
                .map { s ->
                    obj(
                        "id" to s.id,
                        "name" to s.name,
                        "level" to s.level,
                        "desc" to s.text,
                        "damage_roll" to s.dice,
                        "attack_roll" to (s.kind == "attack"),
                        "saving_throw_ability" to s.save,
                        "kind" to s.kind,
                    )
                }
    }

    fun search(query: String, edition: String, kind: String = ""): List<JsonObject> =
        catalog
            .filter {
                it.text("edition") == edition &&
                    (kind.isEmpty() || it.text("kind") == kind) &&
                    (it.text("name") + " " + it.text("text")).contains(query, true)
            }
            .take(100)
}

val spellAliases =
    mapOf(
        "ray-of-frost" to "ray-frost",
        "cure-wounds" to "cure",
        "guiding-bolt" to "guiding",
        "scorching-ray" to "scorching",
        "spiritual-weapon" to "spiritual",
        "spirit-guardians" to "spirit",
    )

fun spellId(key: String): String {
    val id = key.removePrefix("srd-2014_").removePrefix("srd-2024_")
    return spellAliases[id] ?: id
}

data class CastResult(val character: Character, val text: String)

fun cast(
    c: Character,
    spell: JsonObject,
    circle: Int,
    mode: String = "normal",
    die: (Int) -> Int = { secureInt(it) + 1 },
): CastResult {
    val level = spell.number("level")
    val id = spell.text("id")
    if (level > 0) {
        require(id in c.prepared) { "Сначала подготовьте заклинание" }
        require(
            circle >= level &&
                (c.slots().getOrElse(circle - 1) { 0 } >
                    c.spentSlots.getOrElse(circle.toString()) { 0 })
        ) {
            "Нет свободной ячейки этого круга"
        }
    }
    val scaling = if (c.level >= 17) 4 else if (c.level >= 11) 3 else if (c.level >= 5) 2 else 1
    val options = spell.rows("casting_options")
    val option =
        if (level > 0) options.find { it.text("type") == "slot_level_$circle" }
        else
            options
                .filter {
                    it.text("type").startsWith("player_level_") &&
                        (it.text("type").substringAfterLast('_').toIntOrNull() ?: 99) <= c.level
                }
                .maxByOrNull { it.text("type").substringAfterLast('_').toIntOrNull() ?: 0 }
    var formula =
        option?.text("damage_roll")?.takeIf { it.isNotBlank() }
            ?: spell.text("damage_roll").replace(" ", "")
    if (level == 0 && option == null && id != "eldritch-blast")
        formula = formula.replace(Regex("^1d"), "${scaling}d")
    val extra = (circle - level).coerceAtLeast(0)
    val heal =
        id in listOf("cure", "healing-word", "heal", "mass-healing-word", "mass-cure-wounds") ||
            spell.text("kind") == "heal"
    if (id in listOf("cure", "healing-word"))
        formula = "${if(c.baseEdition=="srd-2024") circle*2 else circle}d${if(id=="cure")8 else 4}"
    if (id == "magic-missile") formula = "${3+extra}d4+${3+extra}"
    if (id == "eldritch-blast") formula = "1d10"
    if (id == "scorching") formula = "2d6"
    if (id == "spiritual" && c.baseEdition == "srd-2014") formula = "${1+extra/2}d8"
    val rays = if (id == "scorching") 3 + extra else if (id == "eldritch-blast") scaling else 1
    val lines =
        List(rays) { index ->
            val attack =
                if (spell.flag("attack_roll")) check(c.proficiency + c.spellModifier, mode, die)
                else null
            val actual =
                if (attack?.natural == 20)
                    formula.replace(Regex("^(\\d+)d")) { "${it.groupValues[1].toInt()*2}d" }
                else formula
            val damage = runCatching { roll(actual, die) }.getOrNull()
            buildString {
                if (rays > 1) append("Луч ${index+1}: ")
                if (attack != null)
                    append(
                        "атака ${attack.total} (${attack.dice.joinToString()})${if(attack.natural==20) " · крит!" else if(attack.natural==1) " · промах" else ""}. "
                    )
                if (damage != null)
                    append(
                        "${if(heal)"Лечение" else "Урон"}: ${(damage.total+if(heal || id=="spiritual")c.spellModifier else 0).coerceAtLeast(0)} [${damage.dice.joinToString()}]. "
                    )
                if (spell.text("saving_throw_ability").isNotBlank())
                    append("Спасбросок ${spell.text("saving_throw_ability")}: Сл ${c.dc}. ")
                if (damage == null) append("Эффект и сложные броски — по описанию.")
            }
        }
    return CastResult(
        if (level == 0) c
        else
            c.copy(
                spentSlots =
                    c.spentSlots +
                        (circle.toString() to (c.spentSlots.getOrElse(circle.toString()) { 0 } + 1))
            ),
        lines.joinToString("\n"),
    )
}
