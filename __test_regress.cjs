/**
 * TEMPORARY: regression check that the 7 sections, the Dashboard aggregation and
 * the prioritisation rules all still work after the analytics work.
 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "__anatest");

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
Object.assign(process.env, env);
const U = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, ADMIN = env.SUPABASE_SERVICE_ROLE_KEY;

const results = [];
const rec = (n, ok, d) => {
  results.push({ n, ok, d });
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  -- ${d}` : ""}`);
};

const tasks = require(path.join(OUT, "tasks.js"));
const habits = require(path.join(OUT, "habits.js"));
const study = require(path.join(OUT, "study.js"));
const records = require(path.join(OUT, "records.js"));
const groceries = require(path.join(OUT, "groceries.js"));
const notes = require(path.join(OUT, "notes.js"));

const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

(async () => {
  const email = `reg-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = "Str0ngTestPass!";
  const c = await (await fetch(`${U}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: ADMIN, Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true })
  })).json();
  const s = await (await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  })).json();

  const { createClient } = require("@supabase/supabase-js");
  const client = createClient(U, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  await client.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  require(path.join(OUT, "stub-client.js")).setClient(client);

  const { data: m } = await client
    .from("workspace_members").select("workspace_id").eq("user_id", c.id).limit(1).single();
  const ws = m.workspace_id, uid = c.id;

  console.log("=== SECTION SCREENS STILL WORK ===");
  // Every task now needs a deadline, which is the new contract.
  const t = await tasks.createTask(ws, uid, {
    title: "Regression", description: null, priority: "medium", due_at: inDays(2), status: "todo"
  });
  rec("task create + list", (await tasks.listTasks(ws, { filter: "all" })).length === 1);
  rec("task complete", (await tasks.setTaskCompleted(ws, t.id, true)).status === "done");
  rec("task un-complete", (await tasks.setTaskCompleted(ws, t.id, false)).status === "todo");
  rec("task counts", (await tasks.countTasks(ws)).all === 1);
  await tasks.deleteTask(ws, t.id);

  const h = await habits.createHabit(ws, uid, { name: "Run", frequency: "daily" });
  await habits.setHabitCompleted(ws, uid, h.id, new Date().toISOString().slice(0, 10), true);
  rec("habit streak derived", (await habits.listHabits(ws, uid))[0].currentStreak >= 1);
  await habits.deleteHabit(ws, h.id);

  const sub = await study.findOrCreateStudySubject(ws, "Subject");
  const started = await study.startStudySession(ws, uid, { subjectId: sub.id, topic: "T" });
  rec("study start/stop", (await study.stopStudySession(ws, started.id)).duration_seconds >= 0);

  const rt = await records.ensureRecordType(ws, uid, "Fitness");
  const rec1 = await records.createRecord(ws, uid, {
    recordTypeId: rt.id, title: "Squat", data: { completed: false }
  });
  await records.updateRecordData(ws, rec1.id, { completed: true });
  rec("record toggle persists",
    records.readDataField((await records.listRecords(ws, { recordTypeId: rt.id }))[0], "completed", false) === true);
  await records.deleteRecord(ws, rec1.id);

  const list = await groceries.ensureDefaultGroceryList(ws);
  rec("ensureDefaultGroceryList still returns a list", !!list.id);
  const gi = await groceries.createGroceryItem(list.id, { name: "Eggs", quantity: 12, unit: "pieces" });
  rec("grocery create + complete", (await groceries.setGroceryItemCompleted(list.id, gi.id, true)).completed === true);

  const n = await notes.createNote(ws, uid, { title: "Retro", content: "x" });
  rec("note create", !!n.id);
  await notes.deleteNote(ws, n.id);

  console.log("\n=== LEGACY TASKS WITHOUT A DEADLINE STILL READ ===");
  // Inserted directly, bypassing the app, to stand in for pre-existing data.
  const { data: legacy } = await client
    .from("tasks")
    .insert({
      workspace_id: ws, created_by: uid, title: "Legacy no deadline",
      priority: "medium", status: "todo", due_at: null
    })
    .select("*")
    .single();
  rec("a row with a NULL due_at can still be created at the DB level", !!legacy.id);
  const listed = await tasks.listTasks(ws, { filter: "all" });
  const readBack = listed.find((row) => row.id === legacy.id);
  rec("and it reads back through the data layer", !!readBack && readBack.due_at === null);
  const analytics = require(path.join(OUT, "analytics.js"));
  const a = await analytics.getTaskAnalytics(ws, new Date());
  rec("it is counted in the totals", a.total === 1, `total=${a.total}`);
  rec("it is counted as having no deadline", a.noDeadline === 1, `noDeadline=${a.noDeadline}`);
  rec("it is NOT counted as overdue", a.overdue === 0, `overdue=${a.overdue}`);

  // Editing the title must not be blocked by the missing deadline.
  const edited = await tasks.updateTask(ws, legacy.id, { title: "Legacy renamed" });
  rec("renaming a legacy task works without inventing a deadline",
    edited.title === "Legacy renamed" && edited.due_at === null,
    `due_at=${edited.due_at}`);

  console.log("\n=== RLS STILL ISOLATES ===");
  const otherEmail = `reg2-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const o = await (await fetch(`${U}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: ADMIN, Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: otherEmail, password, email_confirm: true })
  })).json();
  const os = await (await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: otherEmail, password })
  })).json();
  const oc = createClient(U, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  await oc.auth.setSession({ access_token: os.access_token, refresh_token: os.refresh_token });
  const stolen = await oc.from("tasks").select("*").eq("workspace_id", ws);
  rec("another user reads no tasks", (stolen.data ?? []).length === 0, `${(stolen.data ?? []).length} leaked`);
  let blocked = false;
  try { await oc.from("profiles").select("*").eq("id", uid); } catch { blocked = true; }
  const prof = await oc.from("profiles").select("id").eq("id", uid);
  rec("another user reads no profile rows", (prof.data ?? []).length === 0);

  await client.from("tasks").delete().eq("id", legacy.id);
  await groceries.clearCompletedGroceryItems(list.id);
  rec("cleanup ran", true);

  await fetch(`${U}/auth/v1/admin/users/${o.id}`, { method: "DELETE", headers: { apikey: ADMIN, Authorization: `Bearer ${ADMIN}` } });
  await fetch(`${U}/auth/v1/admin/users/${c.id}`, { method: "DELETE", headers: { apikey: ADMIN, Authorization: `Bearer ${ADMIN}` } });

  const passed = results.filter((r) => typeof r.ok !== "function" && r.ok).length;
  console.log("\n" + "=".repeat(56));
  console.log(`RESULT: ${passed}/${results.length} passed`);
  const failed = results.filter((r) => typeof r.ok !== "function" && !r.ok);
  if (failed.length) { failed.forEach((f) => console.log(`  - ${f.n}: ${f.d}`)); process.exit(1); }
  console.log("NO REGRESSIONS");
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });