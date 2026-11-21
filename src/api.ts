import { Capacitor } from "@capacitor/core";
export const native = Capacitor.isNativePlatform();
const origin = import.meta.env.VITE_API_URL || "";
export const offlineMode = () =>
  location.pathname === "/local" ||
  location.pathname.startsWith("/local/") ||
  localStorage.getItem("neustroy-mode") === "offline";
export async function appFetch(path: string, init: RequestInit = {}) {
  return offlineMode()
    ? (await import("./local/browser")).localFetch(path, init)
    : fetch(`${origin}/api/${path}`, init);
}
export function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("questbook-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export async function request<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await appFetch(path, {
    method,
    headers: {
      ...authHeaders(),
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) {
    let message = "Ошибка соединения";
    try {
      message = ((await response.json()) as { error: string }).error || message;
    } catch {}
    throw Error(message);
  }
  return response.json() as Promise<T>;
}
export async function upload(id: string, file: File) {
  const response = await appFetch(`clues/${id}/file`, {
    method: "PUT",
    headers: {
      ...authHeaders(),
      "Content-Type": file.type,
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok)
    throw Error(((await response.json()) as { error: string }).error);
}
export async function downloadClue(id: string, name: string) {
  const response = await appFetch(`clues/${id}/file`, {
    headers: authHeaders(),
  });
  if (!response.ok)
    throw Error(((await response.json()) as { error: string }).error);
  saveFile(await response.blob(), decodeURIComponent(name));
}
export async function clueImageUrl(id: string) {
  const response = await appFetch(`clues/${id}/file`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw Error("Не удалось открыть изображение");
  return URL.createObjectURL(await response.blob());
}
export function saveFile(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export async function notifySession(s: {
  id: string;
  title: string;
  start: string;
}) {
  if (!native)
    throw Error(
      "Напоминания на телефоне доступны в сборке Android / iOS. В браузере скачайте событие календаря.",
    );
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const permission = await LocalNotifications.requestPermissions();
  if (permission.display !== "granted")
    throw Error("Разрешите уведомления в настройках телефона");
  const when = new Date(Date.parse(s.start) - 3600000);
  if (+when <= Date.now()) throw Error("До встречи осталось меньше часа");
  let id = 0;
  for (const ch of s.id) id = ((id << 5) - id + ch.charCodeAt(0)) | 0;
  await LocalNotifications.schedule({
    notifications: [
      {
        id: Math.abs(id),
        title: "Через час игра",
        body: s.title,
        schedule: { at: when },
        extra: { sessionId: s.id },
      },
    ],
  });
}
export async function enablePush() {
  if (!native) throw Error("Push подключается в мобильной сборке");
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const p = await PushNotifications.requestPermissions();
  if (p.receive !== "granted") throw Error("Нет разрешения на push");
  await PushNotifications.addListener("registration", async (t) => {
    await request("push", "POST", {
      token: t.value,
      platform: Capacitor.getPlatform(),
    });
  });
  await PushNotifications.register();
}
