import classData from "../data/catalog/classes.json";
import spellData from "../data/catalog/spells.json";
export const editionIds = ["srd-2014", "srd-2024", "custom"] as const;
export type Edition = (typeof editionIds)[number];
export const editions = {
  "srd-2014": {
    name: "D&D 5e · 2014",
    source: "SRD 5.1",
    pdf: "https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf",
  },
  "srd-2024": {
    name: "D&D 5e · 2024",
    source: "SRD 5.2.1",
    pdf: "https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf",
  },
  custom: {
    name: "Свои правила / другая редакция",
    source: "Пакеты мастера",
    pdf: "",
  },
};
export const sheetThemes = {
  standard: "Стандартный",
  blue: "neustroy · синий к8",
  festival: "Цветная гирлянда",
  horror: "Острые грани · хоррор",
  winter: "Зимний лес",
};
type ClassDef = {
  name: string;
  hitDie: number;
  ability: "str" | "dex" | "con" | "int" | "wis" | "cha";
  saves: readonly string[];
  skills: readonly string[];
  caster: "none" | "full" | "half" | "pact";
};
export const classes: Record<string, ClassDef> = {
  barbarian: {
    name: "Варвар",
    hitDie: 12,
    ability: "str",
    saves: ["str", "con"],
    skills: [
      "athletics",
      "animal",
      "intimidation",
      "nature",
      "perception",
      "survival",
    ],
    caster: "none",
  },
  bard: {
    name: "Бард",
    hitDie: 8,
    ability: "cha",
    saves: ["dex", "cha"],
    skills: [
      "acrobatics",
      "animal",
      "arcana",
      "athletics",
      "deception",
      "history",
      "insight",
      "intimidation",
      "investigation",
      "medicine",
      "nature",
      "perception",
      "performance",
      "persuasion",
      "religion",
      "sleight",
      "stealth",
      "survival",
    ],
    caster: "full",
  },
  cleric: {
    name: "Жрец",
    hitDie: 8,
    ability: "wis",
    saves: ["wis", "cha"],
    skills: ["history", "insight", "medicine", "persuasion", "religion"],
    caster: "full",
  },
  druid: {
    name: "Друид",
    hitDie: 8,
    ability: "wis",
    saves: ["int", "wis"],
    skills: [
      "arcana",
      "animal",
      "insight",
      "medicine",
      "nature",
      "perception",
      "religion",
      "survival",
    ],
    caster: "full",
  },
  fighter: {
    name: "Воин",
    hitDie: 10,
    ability: "str",
    saves: ["str", "con"],
    skills: [
      "athletics",
      "acrobatics",
      "history",
      "insight",
      "intimidation",
      "perception",
      "survival",
      "animal",
    ],
    caster: "none",
  },
  monk: {
    name: "Монах",
    hitDie: 8,
    ability: "wis",
    saves: ["str", "dex"],
    skills: [
      "acrobatics",
      "athletics",
      "history",
      "insight",
      "religion",
      "stealth",
    ],
    caster: "none",
  },
  paladin: {
    name: "Паладин",
    hitDie: 10,
    ability: "cha",
    saves: ["wis", "cha"],
    skills: [
      "athletics",
      "insight",
      "intimidation",
      "medicine",
      "persuasion",
      "religion",
    ],
    caster: "half",
  },
  ranger: {
    name: "Следопыт",
    hitDie: 10,
    ability: "wis",
    saves: ["str", "dex"],
    skills: [
      "animal",
      "athletics",
      "insight",
      "investigation",
      "nature",
      "perception",
      "stealth",
      "survival",
    ],
    caster: "half",
  },
  rogue: {
    name: "Плут",
    hitDie: 8,
    ability: "dex",
    saves: ["dex", "int"],
    skills: [
      "acrobatics",
      "athletics",
      "deception",
      "insight",
      "intimidation",
      "investigation",
      "perception",
      "performance",
      "persuasion",
      "sleight",
      "stealth",
    ],
    caster: "none",
  },
  sorcerer: {
    name: "Чародей",
    hitDie: 6,
    ability: "cha",
    saves: ["con", "cha"],
    skills: [
      "arcana",
      "deception",
      "insight",
      "intimidation",
      "persuasion",
      "religion",
    ],
    caster: "full",
  },
  warlock: {
    name: "Колдун",
    hitDie: 8,
    ability: "cha",
    saves: ["wis", "cha"],
    skills: [
      "arcana",
      "deception",
      "history",
      "intimidation",
      "investigation",
      "nature",
      "religion",
    ],
    caster: "pact",
  },
  wizard: {
    name: "Волшебник",
    hitDie: 6,
    ability: "int",
    saves: ["int", "wis"],
    skills: [
      "arcana",
      "history",
      "insight",
      "investigation",
      "medicine",
      "religion",
    ],
    caster: "full",
  },
  custom: {
    name: "Свой класс",
    hitDie: 8,
    ability: "int",
    saves: [],
    skills: [],
    caster: "none",
  },
};
export const classIds = [
  "barbarian",
  "bard",
  "cleric",
  "druid",
  "fighter",
  "monk",
  "paladin",
  "ranger",
  "rogue",
  "sorcerer",
  "warlock",
  "wizard",
  "custom",
] as const;
export type ClassId = (typeof classIds)[number];
export const englishClass: Record<string, string> = {
  barbarian: "Barbarian",
  bard: "Bard",
  cleric: "Cleric",
  druid: "Druid",
  fighter: "Fighter",
  monk: "Monk",
  paladin: "Paladin",
  ranger: "Ranger",
  rogue: "Rogue",
  sorcerer: "Sorcerer",
  warlock: "Warlock",
  wizard: "Wizard",
};
export const sourceClasses = classData as any[];
export const sourceSpells = spellData as any[];
export const baseEdition = (c: { edition?: Edition; rulesBase?: string }) =>
  c.edition === "custom" ? c.rulesBase || "srd-2014" : c.edition || "srd-2014";
export function subclasses(c: {
  edition?: Edition;
  rulesBase?: string;
  classId: string;
}) {
  const base = sourceClasses.find(
    (x) =>
      x.document.key === baseEdition(c) &&
      x.name === englishClass[c.classId] &&
      !x.subclass_of,
  );
  return sourceClasses.filter(
    (x) =>
      x.document.key === baseEdition(c) && x.subclass_of?.key === base?.key,
  );
}
export function classFeatures(c: {
  edition?: Edition;
  rulesBase?: string;
  classId: string;
  level: number;
  subclass?: string;
  customFeatures?: { id: string; name: string; level: number; text: string }[];
}) {
  const entries = sourceClasses.filter(
    (x) =>
      x.document.key === baseEdition(c) &&
      ((x.name === englishClass[c.classId] && !x.subclass_of) ||
        x.key === c.subclass),
  );
  const list = entries
    .flatMap((x) =>
      x.features.map((f: any) => ({
        id: f.key,
        name: f.name,
        level: Math.min(...f.gained_at.map((g: any) => g.level)),
        text: f.desc,
      })),
    )
    .filter((f) => Number.isFinite(f.level) && f.level <= c.level);
  return [
    ...list,
    ...(c.customFeatures || []).filter((f) => f.level <= c.level),
  ];
}
