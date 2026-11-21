type Context = {
  notes?: { title: string; text: string }[];
  log?: { text: string }[];
};
type Source = { name: string; text: string; source: string };

export const agents = [
  ["rules", "Справочник"],
  ["npc", "Набросок NPC"],
  ["backstory", "Предыстория"],
  ["scenario", "Подготовка игры"],
  ["summary", "Сводка журнала"],
  ["contradictions", "Проверка журнала"],
] as const;

export function basicAgent(
  action: string,
  prompt: string,
  sources: Source[],
  context: Context = {},
) {
  const idea = prompt.trim().slice(0, 240);
  if (action === "rules")
    return sources.length
      ? sources
          .map((s) => s.name + " · " + s.source + "\n" + s.text)
          .join("\n\n")
      : "В справочнике не найдено точного совпадения. Попробуйте английское название правила или откройте библиотеку SRD.";
  if (action === "npc")
    return `Черновик NPC\nЗацепка: ${idea}\nЦель: вернуть долг, прежде чем о нём узнает соперник.\nМанера: говорит коротко и замечает мелкие детали.\nТайна мастера: NPC уже сталкивался с этой угрозой.\nВ игре: предложите группе сделку и оставьте цену на её усмотрение.`;
  if (action === "backstory")
    return `Черновик предыстории\nОснова: ${idea}\n1. Что герой оставил дома и почему ушёл?\n2. Кто однажды ему помог и о чём может попросить теперь?\n3. По какому обещанию или долгу его найдут в первой игре?`;
  if (action === "scenario")
    return `План игры\nТема: ${idea}\n1. Стартовая сцена и причина действовать сейчас.\n2. Два пути к цели с разными рисками.\n3. Улика и персонаж, который знает только часть правды.\n4. Выбор группы, меняющий исход.\n5. Открытый вопрос для следующей встречи.`;
  if (action === "summary" || action === "contradictions") {
    const notes = (context.notes || []).slice(0, 10),
      log = (context.log || []).slice(0, 10);
    const items = [
      ...notes.map((n) => n.title + ": " + n.text.slice(0, 250)),
      ...log.map((l) => l.text.slice(0, 250)),
    ];
    if (!items.length)
      return "Для черновика добавьте записи в журнал выбранной кампании.";
    return (
      (action === "summary"
        ? "Выдержки из журнала"
        : "Материалы для сверки дат, имён и обещаний") +
      "\n" +
      items.map((i) => "• " + i).join("\n")
    );
  }
  return null;
}
