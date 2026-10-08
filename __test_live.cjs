/**
 * TEMPORARY: live verification of task deadlines, task analytics and study
 * analytics against the real Supabase project.
 *
 * These three features need NO new columns, so they are fully testable here.
 * Grocery history and reminders need migration 01300 and are therefore covered
 * by the logic tests instead - see the note in the final report.
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

const tasksMod = require(path.join(OUT, "tasks.js"));
const studyMod = require(path.join(OUT, "study.js"));
const analyticsMod = require(path.join(OUT, "analytics.js"));
const studyAnalyticsMod = require(path.join(OUT, "studyAnalytics.js"));

const DAY = 86400000;
const inDays = (n, hour = 12) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

(async () => {
  const email = `an-${Math.random().toString(36).slice(2, 8)}@example.test`;
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

  console.log("=== 1. A TASK DEADLINE IS REQUIRED (data-access layer) ===");
  let rejected = null;
  try {
    await tasksMod.createTask(ws, uid, {
      title: "No deadline", description: null, priority: "medium", due_at: null, status: "todo"
    });
  } catch (e) { rejected = e; }
  rec("creating a task with no deadline is refused", rejected !== null,
    rejected ? rejected.message : "ACCEPTED");
  rec("and the error is a validation error", rejected?.code === "VALIDATION", rejected?.code);

  let garbage = null;
  try {
    await tasksMod.createTask(ws, uid, {
      title: "Bad deadline", description: null, priority: "medium", due_at: "not-a-date", status: "todo"
    });
  } catch (e) { garbage = e; }
  rec("an unparseable deadline is refused", garbage !== null, garbage?.message);

  console.log("\n=== 2. CREATE / EDIT WITH A DEADLINE ===");
  const overdue = await tasksMod.createTask(ws, uid, {
    title: "Overdue task", description: null, priority: "high",
    due_at: inDays(-3), status: "todo"
  });
  rec("created with a past deadline", !!overdue.id && !!overdue.due_at);

  // Late in the local day, so this is genuinely "still due today" whenever the
  // suite happens to run. At 12:00 it would already be overdue by the time an
  // afternoon run started, making the overdue count time-dependent.
  const dueToday = await tasksMod.createTask(ws, uid, {
    title: "Due today", description: null, priority: "medium",
    due_at: inDays(0, 23), status: "todo"
  });
  const future = await tasksMod.createTask(ws, uid, {
    title: "Future task", description: null, priority: "low",
    due_at: inDays(5), status: "todo"
  });
  const completed = await tasksMod.createTask(ws, uid, {
    title: "Completed task", description: null, priority: "medium",
    due_at: inDays(-10), status: "done"
  });
  rec("a completed task records completed_at", !!completed.completed_at,
    completed.completed_at);

  const edited = await tasksMod.updateTask(ws, future.id, { due_at: inDays(-1), title: "Pulled forward" });
  rec("the deadline can be edited", new Date(edited.due_at) < new Date(), edited.due_at);
  rec("the new deadline is persisted",
    Math.abs(new Date(edited.due_at).getTime() - new Date(inDays(-1)).getTime()) < 60000);

  let cleared = null;
  try {
    await tasksMod.updateTask(ws, future.id, { due_at: null });
  } catch (e) { cleared = e; }
  rec("a deadline cannot be removed", cleared !== null, cleared?.message ?? "ACCEPTED");

  console.log("\n=== 3. TASK ANALYTICS ===");
  const a = await analyticsMod.getTaskAnalytics(ws, new Date());
  rec("total counted", a.total === 4, `${a.total}`);
  rec("completed counted", a.completed === 1, `${a.completed}`);
  rec("pending counted", a.pending === 3, `${a.pending}`);
  rec("overdue counted", a.overdue === 2,
    `${a.overdue} (edited-pulled-forward + overdue)`);
  rec("a COMPLETED task is never overdue even with a past deadline",
    a.overdue === 2 && a.overdue < a.pending,
    `overdue=${a.overdue} < pending=${a.pending}; the completed task was due 10 days ago`);
  rec("due today counted", a.dueToday === 1, `${a.dueToday}`);
  rec("completion rate is a whole percentage",
    Number.isInteger(a.completionRate) && a.completionRate === Math.round((1 / 4) * 100),
    `${a.completionRate}%`);

  const trend = await analyticsMod.getCompletionTrend(ws, 30, new Date());
  rec("trend returns one bucket per day", trend.length === 30, `${trend.length}`);
  rec("trend buckets sum to the completed count",
    trend.reduce((n, p) => n + p.completed, 0) === 1,
    `${trend.reduce((n, p) => n + p.completed, 0)}`);
  rec("empty days are present as zeroes",
    trend.some((p) => p.completed === 0));

  const priorities = await analyticsMod.getPriorityBreakdown(ws);
  rec("priority breakdown covers every task",
    priorities.reduce((n, p) => n + p.count, 0) === 4,
    priorities.map((p) => `${p.label}:${p.count}`).join(" "));
  rec("priorities are ordered High, Medium, Low",
    priorities[0]?.label === "High", priorities.map((p) => p.label).join(","));

  const categories = await analyticsMod.getCategoryBreakdown(ws);
  rec("uncategorised tasks are accounted for",
    categories.reduce((n, p) => n + p.count, 0) === 4,
    categories.map((p) => `${p.label}:${p.count}`).join(" "));

  console.log("\n=== 4. STUDY ANALYTICS (duration-weighted) ===");
  const subject = await studyMod.findOrCreateStudySubject(ws, "Python");
  const other = await studyMod.findOrCreateStudySubject(ws, "Maths");

  // A long session and a short one. If sessions were counted equally these would
  // tie; weighting by duration must not.
  const long1 = await studyMod.startStudySession(ws, uid, { subjectId: subject.id, topic: "Async" });
  await client.from("study_sessions").update({ ended_at: new Date(Date.now() + 7200000).toISOString() }).eq("id", long1.id);
  const short1 = await studyMod.startStudySession(ws, uid, { subjectId: other.id, topic: "Limits" });
  await client.from("study_sessions").update({ ended_at: new Date(Date.now() + 1200000).toISOString() }).eq("id", short1.id);
  const long2 = await studyMod.startStudySession(ws, uid, { subjectId: subject.id, topic: "Generators" });
  await client.from("study_sessions").update({ ended_at: new Date(Date.now() + 7200000).toISOString() }).eq("id", long2.id);
  // One still running, which must be excluded from every total.
  await studyMod.startStudySession(ws, uid, { subjectId: subject.id, topic: "Running" });

  const st = await studyAnalyticsMod.getStudyAnalytics(ws, uid, new Date());
  rec("three completed sessions counted", st.completedSessions === 3, `${st.completedSessions}`);
  rec("the running session is excluded", st.openSessions === 1, `${st.openSessions}`);
  rec("total time is the sum of real durations",
    st.totalSeconds === 7200 + 1200 + 7200,
    `${st.totalSeconds}s = ${st.totalSeconds / 3600}h`);
  rec("today equals total (all logged today)", st.todaySeconds === st.totalSeconds);
  rec("week and month include today",
    st.weekSeconds === st.totalSeconds && st.monthSeconds === st.totalSeconds);

  const python = st.bySubject.find((s) => s.label === "Python");
  const maths = st.bySubject.find((s) => s.label === "Maths");
  rec("subject time is duration-weighted, not session-weighted",
    python.totalSeconds === 14400 && maths.totalSeconds === 1200,
    `Python ${python.totalSeconds}s (2 sessions), Maths ${maths.totalSeconds}s (1 session)`);
  rec("the most-studied subject is the one with most TIME",
    st.topSubject.label === "Python",
    `${st.topSubject.label} despite Maths having the same session count pattern`);
  rec("average session duration is the mean, not the max",
    st.averageSessionSeconds === Math.round(15600 / 3),
    `${Math.round(st.averageSessionSeconds / 60)} min`);
  rec("recent sessions are listed newest first",
    st.recentSessions.length === 3 &&
    new Date(st.recentSessions[0].startedAt) >= new Date(st.recentSessions[2].startedAt));
  rec("no double counting: sum of subjects equals total",
    st.bySubject.reduce((n, s) => n + s.totalSeconds, 0) === st.totalSeconds);

  const stTrend = await studyAnalyticsMod.getStudyTrend(ws, uid, 30, new Date());
  rec("study trend has one bucket per day", stTrend.length === 30);
  rec("study trend total matches",
    stTrend.reduce((n, p) => n + p.totalSeconds, 0) === st.totalSeconds,
    `${stTrend.reduce((n, p) => n + p.totalSeconds, 0)}s`);
  rec("today's bucket holds all of it",
    stTrend[stTrend.length - 1].totalSeconds === st.totalSeconds);

  console.log("\n=== 5. DELETED AND EDGE-CASE TASKS ===");
  const scratch = await tasksMod.createTask(ws, uid, {
    title: "Deleted task", description: null, priority: "low", due_at: inDays(-5), status: "todo"
  });
  let withScratch = await analyticsMod.getTaskAnalytics(ws, new Date());
  rec("a new overdue task is counted", withScratch.overdue === 3, `${withScratch.overdue}`);
  await tasksMod.deleteTask(ws, scratch.id);
  let afterDelete = await analyticsMod.getTaskAnalytics(ws, new Date());
  rec("a deleted task disappears from every count",
    afterDelete.overdue === 2 && afterDelete.total === 4,
    `total=${afterDelete.total} overdue=${afterDelete.overdue}`);

  console.log("\n=== 6. ANOTHER USER SEES NONE OF IT ===");
  const otherEmail = `an2-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const o = await (await fetch(`${U}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: ADMIN, Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: otherEmail, password, email_confirm: true })
  })).json();
  const os = await (await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: otherEmail, password })
  })).json();
  const oc = createClient(U, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  await oc.auth.setSession({ access_token: os.access_token, refresh_token: os.refresh_token });
  const { data: om } = await oc.from("workspace_members").select("workspace_id").eq("user_id", o.id).limit(1).single();

  const otherA = await analyticsMod.getTaskAnalytics(om.workspace_id, new Date());
  rec("another user's analytics are empty", otherA.total === 0 && otherA.overdue === 0,
    `total=${otherA.total}`);
  const otherS = await studyAnalyticsMod.getStudyAnalytics(om.workspace_id, o.id, new Date());
  rec("another user's study analytics are empty",
    otherS.totalSeconds === 0 && otherS.completedSessions === 0);
  const steal = await oc.from("tasks").select("*").eq("workspace_id", ws);
  rec("RLS blocks reading the tasks directly", (steal.data ?? []).length === 0);

  console.log("\n=== CLEANUP ===");
  for (const t of [overdue, dueToday, future, completed]) await tasksMod.deleteTask(ws, t.id);
  rec("cleanup ran", true);

  await fetch(`${U}/auth/v1/admin/users/${o.id}`, { method: "DELETE", headers: { apikey: ADMIN, Authorization: `Bearer ${ADMIN}` } });
  await fetch(`${U}/auth/v1/admin/users/${c.id}`, { method: "DELETE", headers: { apikey: ADMIN, Authorization: `Bearer ${ADMIN}` } });

  const passed = results.filter((r) => r.ok).length;
  console.log("\n" + "=".repeat(58));
  console.log(`RESULT: ${passed}/${results.length} passed`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { failed.forEach((f) => console.log(`  - ${f.n}: ${f.d}`)); process.exit(1); }
  console.log("DEADLINES + ANALYTICS VERIFIED AGAINST SUPABASE");
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });