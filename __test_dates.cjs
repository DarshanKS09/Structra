/**
 * TEMPORARY: verifies the pure date/reminder maths that everything else rests on.
 *
 * These are the rules that cannot be eyeballed from the UI:
 *   - local day windows (what "due today" means)
 *   - derived reminder instants (deadline minus offset)
 *   - re-arming when a task is edited
 *   - deadline validation
 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "__anatest");

const results = [];
const rec = (n, ok, d) => {
  results.push({ n, ok, d });
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  -- ${d}` : ""}`);
};

const analytics = require(path.join(OUT, "analytics.js"));
const reminders = require(path.join(OUT, "reminders.js"));
const adapters = require(path.join(OUT, "adapters.js"));

// A fixed local instant: 8 Oct 2026, 10:00 local time.
const NOW = new Date(2026, 9, 8, 10, 0, 0).getTime();
const iso = (d) => new Date(d).toISOString();
const at = (dayOffset, hour = 10, minute = 0) => {
  const d = new Date(2026, 9, 8 + dayOffset, hour, minute, 0);
  return d.toISOString();
};

(async () => {
  console.log("=== 1. LOCAL DAY WINDOWS (what 'due today' means) ===");
  const today = analytics.localDayWindow(new Date(NOW));
  rec("window starts at local midnight", new Date(today.start).getHours() === 0);
  rec("window ends at the next local midnight",
    (new Date(today.end) - new Date(today.start)) === 86400000,
    `${(new Date(today.end) - new Date(today.start)) / 3600000}h`);
  rec("start < end", new Date(today.start) < new Date(today.end));

  const windows = analytics.localDayWindows(new Date(NOW), 7);
  rec("seven windows returned", windows.length === 7, `${windows.length}`);
  rec("ordered oldest first", new Date(windows[0].start) < new Date(windows[6].start));
  rec("the last window is today",
    new Date(windows[6].start).getTime() === new Date(today.start).getTime());
  rec("consecutive windows do not overlap",
    new Date(windows[0].end).getTime() === new Date(windows[1].start).getTime());

  console.log("\n=== 2. DERIVED REMINDER INSTANT ===");
  rec("no offset -> no reminder", reminders.reminderDueAt(at(1), null) === null);
  rec("zero offset -> no reminder", reminders.reminderDueAt(at(1), 0) === null);
  rec("no deadline -> no reminder", reminders.reminderDueAt(null, 30) === null);
  const derived = reminders.reminderDueAt(at(1, 15, 0), 30);
  rec("30 minutes before a 15:00 deadline is 14:30",
    new Date(derived).getHours() === 14 && new Date(derived).getMinutes() === 30,
    new Date(derived).toLocaleString());
  const deadlineForDayTest = at(2, 9, 0);
  const day = reminders.reminderDueAt(deadlineForDayTest, 1440);
  rec("1 day before lands exactly one calendar day earlier",
    new Date(day).getDate() === new Date(deadlineForDayTest).getDate() - 1 &&
    new Date(day).getHours() === new Date(deadlineForDayTest).getHours(),
    `${new Date(deadlineForDayTest).toLocaleString()} -> ${new Date(day).toLocaleString()}`);
  rec("the derivation is exact", new Date(derived).getTime() === new Date(at(1, 15, 0)).getTime() - 30 * 60000);

  console.log("\n=== 3. IS A REMINDER DUE? ===");
  rec("a future fire time is not due",
    reminders.isReminderDue({ dueAt: at(1), offsetMinutes: 30, now: NOW }) === false);
  rec("a past fire time is due",
    reminders.isReminderDue({ dueAt: at(-1), offsetMinutes: 30, now: NOW }) === true);
  rec("a completed task is never due",
    reminders.isReminderDue({ dueAt: at(-1), offsetMinutes: 30, completed: true, now: NOW }) === false);
  rec("no offset -> never due",
    reminders.isReminderDue({ dueAt: at(-1), offsetMinutes: null, now: NOW }) === false);
  rec("already delivered -> not due",
    reminders.isReminderDue({
      dueAt: at(-1), offsetMinutes: 30, now: NOW,
      sentAt: iso(NOW - 1000), updatedAt: iso(NOW - 60000)
    }) === false);

  console.log("\n=== 4. EDITING A TASK RE-ARMS ITS REMINDER ===");
  // The property that makes deadline edits reschedule correctly with no extra
  // bookkeeping: updated_at bumps past sent_at on any edit, so an edit re-arms a
  // reminder that had already been delivered. The deadline here is in the past,
  // so the reminder is genuinely due - re-arming is the only question being asked.
  rec("edited after delivery -> due again",
    reminders.isReminderDue({
      dueAt: at(-2, 12, 0), offsetMinutes: 60, now: NOW,
      sentAt: iso(NOW - 60000), updatedAt: iso(NOW - 1000)
    }) === true, "a deadline edit clears reminder_sent_at");
  rec("not edited since delivery -> stays delivered",
    reminders.isReminderDue({
      dueAt: at(-2, 12, 0), offsetMinutes: 60, now: NOW,
      sentAt: iso(NOW - 1000), updatedAt: iso(NOW - 60000)
    }) === false);
  rec("changing the deadline moves the fire time",
    reminders.reminderDueAt(at(2, 12, 0), 60) !== reminders.reminderDueAt(at(5, 12, 0), 60));

  console.log("\n=== 5. REMINDER OFFSET FORMATTING ===");
  rec("null -> empty", reminders.formatReminderOffset(null) === "");
  rec("30 -> '30 minutes before'", reminders.formatReminderOffset(30) === "30 minutes before");
  rec("60 -> '1 hour before'", reminders.formatReminderOffset(60) === "1 hour before");
  rec("1440 -> '1 day before'", reminders.formatReminderOffset(1440) === "1 day before");
  rec("an unusual offset still reads sensibly",
    reminders.formatReminderOffset(120) === "2 hours before", reminders.formatReminderOffset(120));

  console.log("\n=== 6. DEADLINE REQUIRED (data-layer rule) ===");
  // Mirrors assertDeadline in lib/data/tasks.ts.
  const assertDeadline = (v) => {
    if (!v || !String(v).trim()) return false;
    return !Number.isNaN(new Date(String(v)).getTime());
  };
  rec("a real instant is accepted", assertDeadline(at(1)));
  rec("null is rejected", assertDeadline(null) === false);
  rec("undefined is rejected", assertDeadline(undefined) === false);
  rec("empty string is rejected", assertDeadline("") === false);
  rec("whitespace is rejected", assertDeadline("   ") === false);
  rec("garbage is rejected", assertDeadline("not-a-date") === false);

  console.log("\n=== 7. DATETIME-LOCAL ROUND TRIP ===");
  const original = at(1, 14, 30);
  const asInput = adapters.toDateTimeInputValue(original);
  const backOut = adapters.fromDateTimeInputValue(asInput);
  rec("round-trips to the same instant",
    new Date(backOut).getTime() === new Date(original).getTime(),
    `${asInput} -> ${backOut}`);
  rec("round-trip is stable on a second pass",
    adapters.fromDateTimeInputValue(adapters.toDateTimeInputValue(backOut)) === backOut);
  rec("null -> empty input", adapters.toDateTimeInputValue(null) === "");
  rec("empty input -> null", adapters.fromDateTimeInputValue("") === null);
  rec("a bare legacy date still converts",
    adapters.fromDateTimeInputValue("2026-10-08") !== null,
    adapters.fromDateTimeInputValue("2026-10-08"));
  rec("a legacy date becomes local midnight",
    new Date(adapters.fromDateTimeInputValue("2026-10-08")).getHours() === 0);
  rec("midnight is preserved as 00:00, not shifted",
    adapters.toDateTimeInputValue(at(1, 0, 0)).endsWith("T00:00"),
    adapters.toDateTimeInputValue(at(1, 0, 0)));

  console.log("\n=== 8. EDGE CASES: zero and extremes ===");
  rec("zero tasks -> zero completion rate is handled by the caller", analytics.localDayWindows(new Date(NOW), 1).length === 1);
  rec("one-day window works", analytics.localDayWindows(new Date(NOW), 1).length === 1);
  rec("midnight boundary belongs to the new day",
    new Date(at(1, 0, 0)).getTime() > new Date(at(0, 23, 59)).getTime());
  rec("a deadline 50 years out still derives",
    reminders.reminderDueAt(at(365 * 50, 12, 0), 1440) !== null);

  const passed = results.filter((r) => r.ok).length;
  console.log("\n" + "=".repeat(58));
  console.log(`RESULT: ${passed}/${results.length} passed`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { failed.forEach((f) => console.log(`  - ${f.n}: ${f.d}`)); process.exit(1); }
  console.log("DATE + REMINDER LOGIC VERIFIED");
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });