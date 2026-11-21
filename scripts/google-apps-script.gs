/** Deploy as Web App, execute as owner. Configure Script Properties below.
 * Enable advanced Google Calendar service (Calendar API).
 * SECRET, SHEET_ID, CALENDAR_ID, optionally TELEGRAM_BOT_TOKEN, TELEGRAM_CONTACTS.
 * TELEGRAM_CONTACTS is JSON: {"@username":"123456789"}; user must /start the bot.
 */
function doPost(e) {
  var props = PropertiesService.getScriptProperties(),
    input;
  try {
    input = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: "Invalid JSON" });
  }
  if (
    !props.getProperty("SECRET") ||
    input.secret !== props.getProperty("SECRET")
  )
    return reply({ ok: false, error: "Unauthorized" });
  if (input.action === "availability") {
    var start = new Date(input.start),
      end = new Date(input.end);
    if (
      isNaN(start) ||
      isNaN(end) ||
      end <= start ||
      end - start > 93 * 86400000
    )
      return reply({ ok: false, error: "Invalid dates" });
    var events = CalendarApp.getCalendarById(
      props.getProperty("CALENDAR_ID"),
    ).getEvents(start, end);
    return reply({
      ok: true,
      busy: events.map(function (x) {
        return {
          start: x.getStartTime().toISOString(),
          end: x.getEndTime().toISOString(),
        };
      }),
    });
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var doc = SpreadsheetApp.openById(props.getProperty("SHEET_ID"));
    var sheet = doc.getSheetByName("Questbook") || doc.insertSheet("Questbook");
    if (sheet.getLastRow() === 0)
      sheet.appendRow([
        "eventId",
        "time",
        "event",
        "bookingId",
        "name",
        "contact",
        "price",
        "formJSON",
        "delivery",
      ]);
    var found = sheet
      .getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1)
      .createTextFinder(input.eventId)
      .matchEntireCell(true)
      .findNext();
    var d = input.data || {},
      b = d.booking || {},
      row;
    if (found && sheet.getRange(found.getRow(), 9).getValue() === "done")
      return reply({ ok: true, duplicate: true });
    if (found) row = found.getRow();
    else {
      sheet.appendRow(
        [
          input.eventId,
          new Date().toISOString(),
          input.event,
          d.id,
          b.name || d.title || "",
          b.contact || "",
          d.total || "",
          JSON.stringify(b),
          "pending",
        ].map(safeCell),
      );
      row = sheet.getLastRow();
    }
    var eventId = "q" + hexDigest(d.id || input.eventId); // deterministic, valid base32hex Calendar ID
    if (
      input.event === "booking.confirmed" ||
      input.event === "session.confirmed"
    ) {
      var date = b.start || d.start,
        end = b.start
          ? new Date(Date.parse(b.start) + b.hours * 3600000).toISOString()
          : d.end;
      var event = {
        id: eventId,
        summary: "Questbook · " + (b.name || d.title || "Игра"),
        start: { dateTime: date },
        end: { dateTime: end },
        description: "Заявка " + d.id,
        reminders: {
          useDefault: false,
          overrides: [{ method: "popup", minutes: 60 }],
        },
      };
      try {
        Calendar.Events.insert(event, props.getProperty("CALENDAR_ID"));
      } catch (err) {
        if (
          String(err).indexOf("409") === -1 &&
          String(err).indexOf("already exists") === -1
        )
          throw err;
      }
    }
    if (input.event === "session.cancelled") {
      try {
        Calendar.Events.remove(props.getProperty("CALENDAR_ID"), eventId);
      } catch (err) {
        if (!/404|410|Not Found|deleted/i.test(String(err))) throw err;
      }
    }
    if (b.contact) {
      var message =
        "Questbook · " +
        ({
          "booking.requested": "Заявка получена, ждёт подтверждения мастером.",
          "booking.confirmed": "Бронь подтверждена!",
          "booking.declined":
            "Эту заявку не удалось подтвердить. Свяжитесь с мастером.",
        }[input.event] || input.event) +
        "\nНомер: " +
        d.id +
        "\nПредварительная стоимость: " +
        d.total +
        " ₽" +
        (b.start ? "\nДата: " + b.start : "");
      // A retry after provider acceptance can repeat a confirmation (at-least-once delivery).
      if (b.channel === "email")
        MailApp.sendEmail({
          to: b.contact,
          subject: "Questbook · ваша заявка",
          body: message,
        });
      if (b.channel === "telegram") {
        var contacts = JSON.parse(
            props.getProperty("TELEGRAM_CONTACTS") || "{}",
          ),
          chat = contacts[b.contact.toLowerCase()];
        if (chat && props.getProperty("TELEGRAM_BOT_TOKEN")) {
          var resp = UrlFetchApp.fetch(
            "https://api.telegram.org/bot" +
              props.getProperty("TELEGRAM_BOT_TOKEN") +
              "/sendMessage",
            {
              method: "post",
              contentType: "application/json",
              payload: JSON.stringify({ chat_id: chat, text: message }),
            },
          );
          if (!JSON.parse(resp.getContentText()).ok)
            throw new Error("Telegram failed");
        } else {
          sheet.getRange(row, 9).setValue("needs_telegram_chat_id");
          return reply({
            ok: false,
            error: "User must start bot and chat ID must be linked",
          });
        }
      }
    }
    sheet.getRange(row, 9).setValue("done");
    return reply({ ok: true });
  } catch (err) {
    return reply({
      ok: false,
      error: "Integration failed; check Apps Script executions",
    });
  } finally {
    lock.releaseLock();
  }
}
function reply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
function hexDigest(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
    .map(function (x) {
      return ("0" + ((x + 256) % 256).toString(16)).slice(-2);
    })
    .join("");
}

function safeCell(value) {
  return typeof value === "string" && /^[=+@-]/.test(value)
    ? "'" + value
    : value;
}
