export function startTelegramPolling({ configuration, dispatch, DB, port }) {
  const controller = new AbortController();
  const pause = (ms) =>
    new Promise((resolve) => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", finish);
        resolve();
      };
      timer = setTimeout(finish, ms);
      controller.signal.addEventListener("abort", finish, { once: true });
      if (controller.signal.aborted) finish();
    });
  const task = (async () => {
    while (!controller.signal.aborted) {
      try {
        const config = await configuration();
        if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_WEBHOOK_SECRET) {
          await pause(5000);
          continue;
        }
        const token = config.TELEGRAM_BOT_TOKEN,
          offsetKey = "telegram:offset:" + token.split(":")[0];
        const saved = await DB.prepare(
          "SELECT value FROM site_config WHERE id=?",
        )
          .bind(offsetKey)
          .first();
        const response = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              offset: Number(saved?.value || 0),
              timeout: 25,
              allowed_updates: ["message"],
            }),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(35000),
            ]),
          },
        );
        if (!response.ok) {
          console.error("Telegram polling unavailable:", response.status);
          await pause(10000);
          continue;
        }
        const result = await response.json();
        if (!result.ok) {
          await pause(10000);
          continue;
        }
        for (const update of result.result || []) {
          const reply = await dispatch(
            new Request(`http://localhost:${port}/telegram/webhook`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Telegram-Bot-Api-Secret-Token":
                  config.TELEGRAM_WEBHOOK_SECRET,
              },
              body: JSON.stringify(update),
            }),
          );
          if (!reply.ok) throw Error("Webhook rejected update");
          const body = await reply.json();
          if (body.method === "sendMessage") {
            const delivered = await fetch(
              `https://api.telegram.org/bot${token}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.any([
                  controller.signal,
                  AbortSignal.timeout(20000),
                ]),
              },
            );
            if (!delivered.ok) throw Error("Telegram did not accept reply");
          }
          await DB.prepare(
            "INSERT INTO site_config(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
          )
            .bind(offsetKey, String(update.update_id + 1))
            .run();
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Telegram polling temporarily unavailable");
          await pause(5000);
        }
      }
    }
  })();
  return {
    stop() {
      controller.abort();
    },
    done: task,
  };
}
