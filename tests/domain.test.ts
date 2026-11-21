import test from "node:test";
import assert from "node:assert/strict";
import {
  mod,
  proficiency,
  maxHp,
  defaultCharacter,
  slotMax,
  cast,
  check,
  roll,
  price,
  ics,
  bookingSchema,
  availableSpells,
} from "../src/domain";
import { characterSchema, armorClass } from "../src/domain";
import { classFeatures, classes } from "../src/rules";
test("модификаторы, мастерство и HP на границах уровней", () => {
  assert.equal(mod(9), -1);
  assert.equal(mod(3), -4);
  assert.equal(proficiency(1), 2);
  assert.equal(proficiency(5), 3);
  assert.equal(proficiency(20), 6);
  const c = defaultCharacter("wizard");
  assert.equal(maxHp(c), 8);
  c.level = 3;
  assert.equal(maxHp(c), 20);
  assert.deepEqual(slotMax(c), [4, 2]);
});
test("преимущество и помеха выбирают правильный d20", () => {
  let i = 0;
  assert.equal(check(3, "advantage", () => [2, 19][i++]).total, 22);
  i = 0;
  assert.equal(check(-1, "disadvantage", () => [2, 19][i++]).total, 1);
  assert.equal(roll("2d6+3", () => 4).total, 11);
  assert.throws(() => roll("999d20"));
});
test("заклинание расходует ячейку один раз и не допускает перерасход", () => {
  let c = defaultCharacter("wizard");
  const original = structuredClone(c);
  c = cast(c, "magic-missile", 1).character;
  assert.equal(c.spentSlots[1], 1);
  assert.deepEqual(original.spentSlots, {});
  c = cast(c, "magic-missile", 1).character;
  assert.throws(() => cast(c, "magic-missile", 1), /ячейки/);
  assert.throws(() => cast(c, "fireball", 3), /недоступно/);
  assert.equal(cast(c, "fire-bolt", 0).character.spentSlots[1], 2);
});
test("нельзя кастовать неподготовленное, ограничение класса и круга", () => {
  const c = defaultCharacter("cleric");
  assert(!availableSpells(c).some((s) => s.id === "fire-bolt"));
  assert.throws(() => cast(c, "healing-word", 1), /подготовьте/);
  assert.throws(() => cast(c, "cure", 0), /ячейки/);
  assert.throws(() => cast(c, "cure", 9), /ячейки/);
});
test("стоимость считается на сервере с дополнительными услугами", () => {
  const quote = price({
    hours: 4,
    players: 6,
    format: "offline",
    characters: "custom",
    extras: ["video", "miniatures", "video"],
  });
  assert.equal(quote.total, 19800);
  assert.equal(quote.rows.filter((r) => r.name === "Видеозапись").length, 1);
});
test("ICS сохраняет UTC, экранирует строки и переносит длинный русский текст", () => {
  const data = ics(
    "Тайна, леса;\n" + "Длинный заголовок ".repeat(10),
    "2027-01-01T12:00:00Z",
    "2027-01-01T16:00:00Z",
    "test",
  );
  assert(data.includes("DTSTART:20270101T120000Z"));
  assert(data.includes("SUMMARY:Тайна\\, леса\\;\\n"));
  for (const line of data.split("\r\n")) assert(Buffer.byteLength(line) <= 75);
  assert(data.includes("TRIGGER:-PT1H"));
});
test("нельзя отправить заявку без согласия или с неверным email", () => {
  const b = {
    format: "online",
    players: 4,
    age: "adults",
    hours: 4,
    experience: "none",
    rules: "simple",
    characters: "ready",
    genres: [],
    mood: "Уютно",
    settings: [],
    extras: [],
    wishes: "",
    name: "Игрок",
    channel: "email",
    contact: "bad",
    consent: true,
  };
  assert(!bookingSchema.safeParse(b).success);
  assert(
    bookingSchema.safeParse({ ...b, contact: "player@example.com" }).success,
  );
  assert(
    !bookingSchema.safeParse({
      ...b,
      contact: "player@example.com",
      consent: false,
    }).success,
  );
});

test("при низком Телосложении каждый уровень даёт минимум один хит", () => {
  const c = defaultCharacter("wizard");
  c.scores.con = 3;
  c.level = 3;
  assert.equal(maxHp(c), 4);
});
test("две редакции не смешивают лечение и ранние ячейки паладина", () => {
  let c = defaultCharacter("cleric");
  c.prepared = ["cure"];
  const classic = cast(c, "cure", 1);
  assert.equal(classic.results[0].damage!.dice.length, 1);
  c.edition = "srd-2024";
  const revised = cast(c, "cure", 1);
  assert.equal(revised.results[0].damage!.dice.length, 2);
  c = defaultCharacter("paladin");
  assert.deepEqual(slotMax(c), []);
  c.edition = "srd-2024";
  assert.deepEqual(slotMax(c), [2]);
});
test("все 12 классов имеют листы, способности из собственной редакции и верные ячейки договора", () => {
  for (const id of Object.keys(classes).filter((x) => x !== "custom")) {
    for (const edition of ["srd-2014", "srd-2024"] as const) {
      const c = characterSchema.parse({
        ...defaultCharacter(id as any),
        edition,
        level: 5,
      });
      assert(classFeatures(c).length > 0, `${id} ${edition}`);
      assert(maxHp(c) > 0);
    }
  }
  const w = defaultCharacter("warlock");
  w.level = 5;
  assert.deepEqual(slotMax(w), [0, 0, 2]);
  assert(availableSpells(w).some((s) => s.name === "Eldritch Blast"));
});
test("старые листы получают редакцию и оформление без потери данных", () => {
  const raw: any = defaultCharacter();
  delete raw.edition;
  delete raw.theme;
  const c = characterSchema.parse(raw);
  assert.equal(c.edition, "srd-2014");
  assert.equal(c.theme, "standard");
  assert.equal(c.name, raw.name);
});
test("классовый КД без доспеха и свой пакет", () => {
  const monk = defaultCharacter("monk");
  monk.scores.wis = 16;
  assert.equal(armorClass(monk), 15);
  const c = defaultCharacter("wizard");
  c.customSpells = [
    {
      id: "custom-1",
      name: "Моя искра",
      level: 0,
      kind: "attack",
      dice: "1d6",
      text: "Авторское заклинание",
    },
  ];
  assert(availableSpells(c).some((s) => s.id === "custom-1"));
  const result = cast(c, "custom-1", 0);
  assert.equal(
    result.results[0].damage?.dice.length,
    result.results[0].attack?.natural === 20 ? 2 : 1,
  );
});

test("лучи Eldritch Blast бросаются отдельно без двойного масштабирования", () => {
  const c = defaultCharacter("warlock");
  c.level = 5;
  const result = cast(c, "eldritch-blast", 0);
  assert.equal(result.results.length, 2);
  for (const r of result.results)
    assert.equal(r.damage?.dice.length, r.attack?.natural === 20 ? 2 : 1);
});
