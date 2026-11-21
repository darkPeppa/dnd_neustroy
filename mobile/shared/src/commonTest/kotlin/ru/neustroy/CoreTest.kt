package ru.neustroy

import io.ktor.client.*
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*

private class MemoryStore : Storage {
    val values = mutableMapOf<String, String>()
    var failWrites = false

    override fun read(key: String) = values[key]

    override fun write(key: String, value: String?) {
        if (failWrites) error("Disk full")
        if (value == null) values.remove(key) else values[key] = value
    }
}

class CoreTest {
    @Test
    fun abilityModifiersUseFloorAndHitPointsHaveMinimumOnePerLevel() {
        val c =
            Character(
                scores =
                    mapOf(
                        "str" to 3,
                        "dex" to 9,
                        "con" to 3,
                        "int" to 16,
                        "wis" to 12,
                        "cha" to 10,
                    ),
                level = 20,
            )
        assertEquals(-4, c.modifier("str"))
        assertEquals(-1, c.modifier("dex"))
        assertEquals(21, c.maxHp)
        assertEquals(6, c.proficiency)
    }

    @Test
    fun editionsSeparateFirstLevelHalfCastersAndWarlockSlots() {
        assertEquals(emptyList(), Character(classId = "paladin", edition = "srd-2014").slots())
        assertEquals(listOf(2), Character(classId = "paladin", edition = "srd-2024").slots())
        assertEquals(listOf(0, 0, 0, 0, 3), Character(classId = "warlock", level = 11).slots())
        assertEquals(listOf(0, 0, 0, 0, 4), Character(classId = "warlock", level = 17).slots())
    }

    @Test
    fun unarmouredDefenceAndShieldFollowClassRules() {
        val base =
            Character(
                scores =
                    mapOf(
                        "str" to 10,
                        "dex" to 14,
                        "con" to 16,
                        "int" to 10,
                        "wis" to 16,
                        "cha" to 10,
                    )
            )
        assertEquals(15, base.copy(classId = "monk").ac)
        assertEquals(14, base.copy(classId = "monk", shield = true).ac)
        assertEquals(17, base.copy(classId = "barbarian", shield = true).ac)
        assertEquals(18, base.copy(armor = "plate").ac)
    }

    @Test
    fun diceRejectMalformedAndExcessiveFormulas() {
        for (value in listOf("0d20", "41d6", "1d1", "2d6+9999", "1d20;42", "NaN")) assertFails {
            roll(value)
        }
        assertEquals(15, roll("2d6+3") { 6 }.total)
        assertEquals(listOf(6, 6), roll("2d6+3") { 6 }.dice)
    }

    @Test
    fun advantageSelectsMaximumAndDisadvantageMinimum() {
        fun generator(): (Int) -> Int {
            val values = ArrayDeque(listOf(4, 19))
            return { values.removeFirst() }
        }
        assertEquals(22, check(3, "advantage", generator()).total)
        assertEquals(7, check(3, "disadvantage", generator()).total)
    }

    @Test
    fun castingConsumesOneSlotAndFailedCastKeepsOriginalSheet() {
        val c = Character(prepared = listOf("magic-missile"))
        val spell =
            obj(
                "id" to "magic-missile",
                "name" to "Magic Missile",
                "level" to 1,
                "damage_roll" to "3d4+3",
            )
        val first = cast(c, spell, 1, die = { 1 })
        assertEquals(1, first.character.spentSlots["1"])
        assertTrue(first.text.contains("6"))
        val second = cast(first.character, spell, 1, die = { 1 })
        assertEquals(2, second.character.spentSlots["1"])
        assertFails { cast(second.character, spell, 1) }
        assertTrue(c.spentSlots.isEmpty())
        assertFails { cast(c.copy(prepared = emptyList()), spell, 1) }
    }

    @Test
    fun eldritchBlastUsesIndependentAttackAndDamageForEachBeam() {
        val spell =
            obj(
                "id" to "eldritch-blast",
                "level" to 0,
                "attack_roll" to true,
                "damage_roll" to "1d10",
            )
        val sequence = ArrayDeque(listOf(10, 3, 11, 4))
        val r =
            cast(
                Character(classId = "warlock", level = 5),
                spell,
                0,
                die = { sequence.removeFirst() },
            )
        assertTrue(r.text.contains("Луч 1"))
        assertTrue(r.text.contains("Луч 2"))
        assertTrue(sequence.isEmpty())
        assertTrue(r.character.spentSlots.isEmpty())
    }

    @Test
    fun healingUsesEditionSpecificDiceAndModifier() {
        val spell = obj("id" to "cure", "level" to 1, "kind" to "heal", "damage_roll" to "1d8")
        val c = Character(classId = "cleric", prepared = listOf("cure"))
        assertTrue(cast(c, spell, 1, die = { 1 }).text.contains("Лечение: 2"))
        assertTrue(
            cast(c.copy(edition = "srd-2024"), spell, 1, die = { 1 }).text.contains("Лечение: 3")
        )
    }

    @Test
    fun classFeaturesAndSpellsNeverMixEditions() {
        val rules =
            RulesData(
                listOf(
                    obj(
                        "key" to "srd-2014_wizard",
                        "document" to obj("key" to "srd-2014"),
                        "features" to
                            listOf(
                                obj(
                                    "key" to "a",
                                    "name" to "Feature",
                                    "desc" to "Text",
                                    "gained_at" to listOf(obj("level" to 3)),
                                )
                            ),
                    )
                ),
                emptyList(),
                emptyList(),
            )
        assertEquals(0, rules.features(Character(level = 2)).size)
        assertEquals(1, rules.features(Character(level = 3)).size)
        assertEquals(0, rules.features(Character(level = 3, edition = "srd-2024")).size)
    }

    @Test
    fun apiAddressPolicyBlocksCredentialsPublicHttpAndPrivateLookingDns() {
        assertEquals("https://example.ru", ConnectionPolicy.normalize("  https://EXAMPLE.ru/ "))
        assertEquals(
            "http://192.168.1.2:8787",
            ConnectionPolicy.normalize("http://192.168.1.2:8787"),
        )
        for (url in
            listOf(
                "http://example.ru",
                "file:///tmp/app",
                "javascript:alert(1)",
                "https://a:b@example.ru",
                "https://example.ru/path",
                "https://example.ru?key=1",
                "https://example.ru:0",
                "http://10.0.0.1.evil.ru",
                "http://010.0.0.1",
                "http://172.32.1.2",
            )) assertFails(url) { ConnectionPolicy.normalize(url) }
    }

    @Test
    fun offlineSheetSurvivesRepositoryRestartWithoutNetwork() = runTest {
        val store = MemoryStore()
        val repository = LocalRepository(store)
        val saved =
            repository
                .call(
                    "characters",
                    "POST",
                    codec.encodeToJsonElement(Character(name = "Сохранённый герой")),
                )
                .jsonObject
        val restarted = LocalRepository(store)
        val restored = restarted.call("characters").jsonArray.single().jsonObject
        assertEquals(saved.text("id"), restored.text("id"))
        assertEquals("Сохранённый герой", restored.getValue("data").jsonObject.text("name"))
    }

    @Test
    fun concurrentOfflineUpdatesUseRevisionAndDoNotOverwriteEachOther() = runTest {
        val repo = LocalRepository(MemoryStore())
        val sheet =
            repo.call("characters", "POST", codec.encodeToJsonElement(Character())).jsonObject
        val attempts =
            (1..8)
                .map { n ->
                    async {
                        runCatching {
                            repo.call(
                                "characters/${sheet.text("id")}",
                                "PUT",
                                obj(
                                    "data" to
                                        codec.encodeToJsonElement(Character(name = "Версия $n")),
                                    "revision" to 1,
                                ),
                            )
                        }
                    }
                }
                .awaitAll()
        assertEquals(1, attempts.count { it.isSuccess })
        assertEquals(2, repo.call("characters").jsonArray.single().jsonObject.number("revision"))
    }

    @Test
    fun failedDiskWriteDoesNotMutateInMemoryOrStoredSheet() = runTest {
        val store = MemoryStore()
        val repo = LocalRepository(store)
        val sheet =
            repo.call("characters", "POST", codec.encodeToJsonElement(Character())).jsonObject
        val before = store.values.toMap()
        store.failWrites = true
        assertFails {
            repo.call(
                "characters/${sheet.text("id")}",
                "PUT",
                obj(
                    "data" to codec.encodeToJsonElement(Character(name = "Не записано")),
                    "revision" to 1,
                ),
            )
        }
        assertEquals(before, store.values)
        assertEquals(1, repo.call("characters").jsonArray.single().jsonObject.number("revision"))
    }

    @Test
    fun bookingPriceIncludesExtrasAndEachMiniature() {
        val b =
            obj(
                "hours" to 4,
                "players" to 6,
                "format" to "offline",
                "characters" to "custom",
                "extras" to listOf("miniatures", "miniatures", "chronicle"),
            )
        assertEquals(20800, quote(b, defaultSettings.getValue("pricing").jsonObject))
    }

    @Test
    fun nativeApiAddsBearerAndRestoresLanCookieForSameServer() = runTest {
        val store = MemoryStore()
        var count = 0
        fun client() =
            HttpClient(
                MockEngine { request ->
                    count++
                    assertEquals("native", request.headers["X-Neustroy-Client"])
                    if (count == 1)
                        assertEquals(
                            "Bearer test-token",
                            request.headers[HttpHeaders.Authorization],
                        )
                    else
                        assertEquals(
                            "neustroy_device=device-signature",
                            request.headers[HttpHeaders.Cookie],
                        )
                    respond(
                        "{}",
                        HttpStatusCode.OK,
                        headersOf(
                            HttpHeaders.ContentType to listOf("application/json"),
                            HttpHeaders.SetCookie to
                                listOf("neustroy_device=device-signature; Path=/; HttpOnly"),
                        ),
                    )
                }
            )
        val first = RemoteRepository("http://192.168.1.2:8787", store, client())
        first.token = "test-token"
        first.call("me")
        first.close()
        val second = RemoteRepository("http://192.168.1.2:8787", store, client())
        second.call("me")
        second.close()
        assertEquals(2, count)
    }

    @Test
    fun nativeClientRejectsLoginRedirectInsteadOfTreatingHtmlAsApi() = runTest {
        val repo =
            RemoteRepository(
                "https://example.ru",
                MemoryStore(),
                HttpClient(
                    MockEngine {
                        respond(
                            "redirect",
                            HttpStatusCode.Found,
                            headersOf(HttpHeaders.Location, "https://chatgpt.com/"),
                        )
                    }
                ),
            )
        val error = assertFails { repo.call("me") }
        assertTrue(error.message!!.contains("внешней авторизацией"))
        repo.close()
    }
}
