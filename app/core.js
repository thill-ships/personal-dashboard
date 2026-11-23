// Shared by /wall and /phone: Supabase client and login, Denver time (with the ?at= test
// override), data loading, live updates, taps, and small formatting and chart helpers.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import * as C from './config.js';

export { C };

export const sb = createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'dashboard-auth' },
});

// ---------------------------------------------------------------------------
// Time (always America/Denver, whatever the device's own time zone)
// ---------------------------------------------------------------------------
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: C.TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function parts(t) {
  const o = {};
  for (const p of partsFmt.formatToParts(new Date(t))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}

function offsetMs(t) {
  const p = parts(t);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}

/** Instant (ms) for a Denver wall-clock time. */
export function zoned(y, m, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const t = guess - offsetMs(guess);
  return guess - offsetMs(t);
}

// ?at=2026-11-18T19:30 pins the clock to that Denver time (it keeps ticking from there).
const params = new URLSearchParams(location.search);
let pinned = null;
{
  const m = (params.get('at') || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) pinned = { at: zoned(+m[1], +m[2], +m[3], +(m[4] ?? 12), +(m[5] ?? 0)), loaded: Date.now() };
}
export const testTime = !!pinned;
export const now = () => (pinned ? pinned.at + (Date.now() - pinned.loaded) : Date.now());

export const pad2 = (n) => String(n).padStart(2, '0');
export const ymd = (p) => `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
export const localDate = (t = now()) => ymd(parts(t));
export function addDays(ds, n) {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function dayStart(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return zoned(y, m, d, 0, 0);
}
/** 0 = Sunday ... 6 = Saturday */
export function weekday(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** The Sunday that starts ds's week (Tyler's weeks run Sunday to Saturday, so on Sunday he sees the week ahead). */
export const weekStartOf = (ds) => addDays(ds, -weekday(ds));
export const hourOf = (t = now()) => { const p = parts(t); return p.h + p.mi / 60; };

/** morning 6:00-17:00, evening 17:00-22:00, night 22:00-6:00 */
export function modeAt(t = now()) {
  const h = parts(t).h;
  if (h >= 22 || h < 6) return 'night';
  return h < 17 ? 'morning' : 'evening';
}

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: C.TZ, hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: C.TZ, weekday: 'long', month: 'short', day: 'numeric' });
const dayShort = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
export const fmtTime = (t) => (t == null ? '' : timeFmt.format(new Date(t)));
export const fmtDate = (t = now()) => dateFmt.format(new Date(t));
export const fmtDay = (ds) => dayShort.format(new Date(ds + 'T12:00:00Z'));
export const clock = (t = now()) => timeFmt.format(new Date(t)).replace(/\s?[AP]M$/, '');

/** "2026-11-17T07:15:00" (Garmin local wall time) -> "7:15 AM" */
export function fmtLocalStamp(s) {
  const m = String(s || '').match(/T(\d{2}):(\d{2})/);
  if (!m) return '';
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
export function hm(sec) {
  if (sec == null) return '—';
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}h ${pad2(m % 60)}m`;
}
export const signed = (v, digits = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(digits);
export const workoutShort = (name) => String(name || '').replace(/\s+\d{1,2}\/\d{1,2}$/, '');

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
export async function session() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

/** Renders a sign-in form into `el` and resolves once signed in. */
export function signInForm(el, { title = 'Dashboard' } = {}) {
  return new Promise((resolve) => {
    el.innerHTML = `
      <form class="login" autocomplete="on">
        <h1>${esc(title)}</h1>
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Sign in</button>
        <p class="login-error" role="alert"></p>
      </form>`;
    const form = el.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const btn = form.querySelector('button');
      btn.disabled = true;
      const { data, error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
      btn.disabled = false;
      if (error) { form.querySelector('.login-error').textContent = error.message; return; }
      resolve(data.session);
    });
  });
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const q = (p) => p.then(({ data, error }) => { if (error) throw error; return data; });

/** True for a dropped or failed connection (phone switching networks, waking up), not a real error. */
export function isNetworkError(err) {
  const m = String(err?.message || err || '');
  return /Load failed|Failed to fetch|NetworkError|network connection was lost|fetch failed|timed out/i.test(m);
}
/** Plain-English message for a failed load or save. */
export function friendlyError(err) {
  return isNetworkError(err) ? "Couldn't reach the internet. Check your connection; it will try again."
    : String(err?.message || err);
}
/** Runs fn, trying again twice (after 1 s and 3 s) if the connection drops. */
export async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 2 || !isNetworkError(err)) throw err;
      await new Promise((r) => setTimeout(r, attempt ? 3000 : 1000));
    }
  }
}

export const loadAll = () => withRetry(loadAllOnce);
async function loadAllOnce() {
  const today = localDate();
  const yest = addDays(today, -1);
  const weekStart = weekStartOf(today);
  const [goals, checks, goalDaily, vitals, activity, ranges, weather, snow, flags, schedule, recs, runs, pending] =
    await Promise.all([
      q(sb.from('goals').select('id,name,sort_order,off_days').eq('active', true).order('sort_order')),
      q(sb.from('goal_checks').select('goal_id,date,done').gte('date', addDays(today, -31)).lte('date', today)),
      q(sb.from('goal_daily').select('date,done_count,total').lte('date', today).order('date')),
      q(sb.from('daily_vitals').select('date,sleep_score,sleep_seconds,deep_seconds,light_seconds,rem_seconds,awake_seconds,sleep_end_local,hrv_overnight_ms,training_readiness,resting_hr,body_battery_wake,watch_last_sync,updated_at')
        .gte('date', addDays(today, -14)).lte('date', today).order('date')),
      q(sb.from('activity_daily').select('date,steps,intensity_min,intensity_min_week,intensity_goal_week,active_kcal,stress_avg,updated_at')
        .gte('date', addDays(today, -14)).lte('date', today).order('date')),
      q(sb.from('metric_ranges').select('metric,low,high,source')),
      q(sb.from('weather_hourly').select('city,hour,temp_f,updated_at')
        .gte('hour', new Date(dayStart(yest)).toISOString()).lt('hour', new Date(dayStart(addDays(today, 1))).toISOString()).order('hour')),
      q(sb.from('snow_reports').select('*').gte('date', addDays(today, -3)).lte('date', today).order('fetched_at', { ascending: false }).limit(40)),
      q(sb.from('day_flags').select('date,snow_dismissed').eq('date', today)),
      q(sb.from('workout_schedule').select('*').gte('date', addDays(weekStart, -1)).lte('date', addDays(weekStart, 7)).order('date')),
      q(sb.from('recommendations').select('*').eq('date', today)),
      q(sb.from('job_runs').select('*')),
      q(sb.from('actions').select('id,type,date,status,requested_at').eq('status', 'pending')),
    ]);
  const ids = new Set();
  for (const s of schedule) for (const k of ['planned_workout_id', 'active_workout_id']) if (s[k]) ids.add(s[k]);
  for (const r of recs) if (r.adjusted_workout_id) ids.add(r.adjusted_workout_id);
  const workouts = ids.size ? await q(sb.from('workouts').select('id,name,kind,steps,est_minutes,variant_of').in('id', [...ids])) : [];
  return {
    loadedAt: Date.now(), today, yest, goals, checks, goalDaily, vitals, activity, weather, snow,
    ranges: Object.fromEntries(ranges.map((r) => [r.metric, r])),
    snowDismissed: !!flags[0]?.snow_dismissed,
    schedule, rec: recs[0] || null, runs, pending,
    workouts: Object.fromEntries(workouts.map((w) => [w.id, w])),
  };
}

// ---------------------------------------------------------------------------
// History (the phone's detail pages load these only when opened)
// ---------------------------------------------------------------------------
/** One week (Sunday to Saturday) of scheduled workouts, with the workouts themselves. */
export const loadWeek = (start) => withRetry(async () => {
  const schedule = await q(sb.from('workout_schedule').select('*').gte('date', start).lte('date', addDays(start, 6)).order('date'));
  const ids = new Set();
  for (const s of schedule) for (const k of ['planned_workout_id', 'active_workout_id']) if (s[k]) ids.add(s[k]);
  const workouts = ids.size ? await q(sb.from('workouts').select('id,name,kind,steps,est_minutes,variant_of').in('id', [...ids])) : [];
  return { start, schedule, workouts: Object.fromEntries(workouts.map((w) => [w.id, w])) };
});

/** Goal checks from a date to today (the goal history page). */
export const loadGoalChecks = (from) => withRetry(() =>
  q(sb.from('goal_checks').select('goal_id,date,done').gte('date', from).order('date')));

/** Which table each metric lives in. */
export const METRIC_TABLE = {
  sleep_score: 'daily_vitals', sleep_seconds: 'daily_vitals', hrv_overnight_ms: 'daily_vitals', training_readiness: 'daily_vitals',
  resting_hr: 'daily_vitals', body_battery_wake: 'daily_vitals',
  steps: 'activity_daily', intensity_min: 'activity_daily', active_kcal: 'activity_daily', stress_avg: 'activity_daily',
};
/** One metric's daily values from a date to today: [{date, value}]. */
export const loadMetric = (key, from) => withRetry(async () => {
  const rows = await q(sb.from(METRIC_TABLE[key]).select(`date,${key}`).gte('date', from).lte('date', localDate()).order('date'));
  return rows.map((r) => ({ date: r.date, value: r[key] == null ? null : +r[key] }));
});

/** Calls onChange (debounced) whenever a table the screens show changes. */
export function subscribe(onChange) {
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 400); };
  const ch = sb.channel('dashboard-' + Math.random().toString(36).slice(2));
  for (const table of ['goal_checks', 'daily_vitals', 'activity_daily', 'workout_schedule', 'recommendations',
    'actions', 'snow_reports', 'day_flags', 'job_runs']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, fire);
  }
  ch.subscribe();
  return ch;
}

// ---------------------------------------------------------------------------
// Taps
// ---------------------------------------------------------------------------
const check = ({ error }) => { if (error) throw error; };

export async function setGoal(goalId, date, done, source) {
  await withRetry(async () => check(await sb.from('goal_checks').upsert(
    { goal_id: goalId, date, done, checked_at: new Date().toISOString(), source },
    { onConflict: 'goal_id,date' })));
}
export async function requestAction(type) {
  await withRetry(async () => check(await sb.from('actions').insert({ type, date: localDate() })));
}
export async function setSnowDismissed(value) {
  await withRetry(async () => check(await sb.from('day_flags').upsert(
    { date: localDate(), snow_dismissed: value, updated_at: new Date().toISOString() }, { onConflict: 'date' })));
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------
export function goalDone(d, goalId, date) {
  return !!d.checks.find((c) => c.goal_id === goalId && c.date === date && c.done);
}

/** Goal index for each finished day (today excluded): [{date, idx, delta}], starting at 100. */
export function goalIndexSeries(d) {
  const { start, perfect, miss } = C.GOAL_INDEX;
  const out = [];
  let idx = start;
  for (const r of d.goalDaily) {
    if (r.date >= d.today) break;
    if (!out.length) out.push({ date: addDays(r.date, -1), idx, delta: 0 });
    const share = r.total ? r.done_count / r.total : 0;
    const delta = (perfect - miss) * share + miss;
    idx += delta;
    out.push({ date: r.date, idx, delta });
  }
  return out;
}

const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
/** Whether a goal is expected on a date (goals can have days of the week off). */
export function goalExpected(g, date) {
  return !(g.off_days || []).includes(weekday(date));
}
/** "Off Sundays" for a goal that's off on that date's day of the week, else ''. */
export const goalOffLabel = (g, date) => (goalExpected(g, date) ? '' : `Off ${DAY_NAMES[weekday(date)]}`);
/** The goals expected on a date, and how many of them are done. */
export function goalCount(d, date) {
  const expected = d.goals.filter((g) => goalExpected(g, date));
  return { done: expected.filter((g) => goalDone(d, g.id, date)).length, total: expected.length };
}

/** Share of expected days each goal was done over the last `days` finished days (since tracking began). */
export function goalRates(d, days = 30) {
  const first = d.goalDaily[0]?.date;
  if (!first) return d.goals.map((g) => ({ ...g, rate: null }));
  const from = [addDays(d.today, -days), first].sort()[1];
  return d.goals.map((g) => {
    let n = 0, done = 0;
    for (let ds = from; ds < d.today; ds = addDays(ds, 1)) {
      if (!goalExpected(g, ds)) continue;
      n++;
      if (goalDone(d, g.id, ds)) done++;
    }
    return { ...g, rate: n ? done / n : null };
  });
}

/** Hourly temps for a city, keyed by hour, for today and yesterday. */
export function cityTemps(d, city) {
  const t = {}, y = {};
  for (const r of d.weather) {
    if (r.city !== city) continue;
    const p = parts(Date.parse(r.hour));
    const ds = ymd(p);
    if (ds === d.today) t[p.h] = +r.temp_f;
    else if (ds === d.yest) y[p.h] = +r.temp_f;
  }
  return { t, y };
}
export function tempAt(map, hour) {
  const h0 = Math.floor(hour), f = hour - h0;
  const a = map[h0], b = map[h0 + 1];
  if (a == null) return null;
  return b == null || !f ? a : a + (b - a) * f;
}
/** Average difference, today minus yesterday, over 6 AM to 10 PM. */
export function dayDiff(w) {
  let s = 0, n = 0;
  for (let h = 6; h <= 22; h++) if (w.t[h] != null && w.y[h] != null) { s += w.t[h] - w.y[h]; n++; }
  return n ? s / n : null;
}
export function diffText(x, what = 'than yesterday') {
  if (x == null) return null;
  const r = Math.round(x);
  if (r === 0) return 'Same as yesterday';
  return `${Math.abs(r)}° ${r < 0 ? 'colder' : 'warmer'} ${what}`;
}
export const deg = (v) => (v == null ? '—' : `${Math.round(v)}°`);

/** Latest Sundance report plus what changed since the previous day's last report. */
export function snowInfo(d) {
  const latest = d.snow[0];
  if (!latest) return null;
  const prev = d.snow.find((r) => r.date < latest.date);
  const openNow = (latest.lifts || []).filter((l) => l.status === 'open');
  const openBefore = new Set((prev?.lifts || []).filter((l) => l.status === 'open').map((l) => l.name));
  const nextSnow = (latest.outlook || []).find((o) => o.snow_in > 0);
  return {
    ...latest,
    baseChange: prev && latest.base_in != null && prev.base_in != null ? latest.base_in - prev.base_in : null,
    newlyOpen: prev ? openNow.filter((l) => !openBefore.has(l.name)).map((l) => l.name) : [],
    nextSnow,
    isSnowDay: latest.date === d.today && latest.snow_day,
    webcam: latest.webcam_image_url ? `${latest.webcam_image_url}?t=${Math.floor(Date.now() / 300000)}` : null,
  };
}

/** Recovery and activity rows: value today, normal range, 14-day series, and whether to flag it. */
export const METRICS = {
  sleep_score: { label: 'Sleep score', fmt: (v) => num(v), worse: 'low' },
  sleep_seconds: { label: 'Sleep', fmt: hm, worse: 'low' },
  hrv_overnight_ms: { label: 'Overnight HRV', fmt: (v) => `${num(v)} ms`, worse: 'low' },
  training_readiness: { label: 'Training readiness', fmt: (v) => num(v), worse: 'low' },
  resting_hr: { label: 'Resting HR', fmt: (v) => `${num(v)} bpm`, worse: 'high' },
  body_battery_wake: { label: 'Body battery at wake', fmt: (v) => num(v), worse: 'low' },
  steps: { label: 'Steps', fmt: (v) => num(v), worse: 'low' },
  intensity_min: { label: 'Intensity minutes', fmt: (v) => num(v), worse: 'low' },
  active_kcal: { label: 'Active calories', fmt: (v) => num(v), worse: 'low' },
  stress_avg: { label: 'Average stress', fmt: (v) => num(v), worse: 'high' },
};

export function metricRow(d, key, rows) {
  const def = METRICS[key];
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r[key]]));
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const v = byDate[addDays(d.today, -i)];
    series.push(v == null ? null : +v);
  }
  const value = series[13];
  const r = d.ranges[key];
  const lo = r ? +r.low : null, hi = r ? +r.high : null;
  const flagged = value != null && r && ((def.worse === 'low' && value < lo) || (def.worse === 'high' && value > hi));
  return {
    key, label: def.label, value, text: value == null ? '—' : def.fmt(value), series, lo, hi, flagged,
    normal: r ? (lo === hi ? `Normal ${def.fmt(lo)}` : `Normal ${def.fmt(lo)} to ${def.fmt(hi)}`) : 'Normal range after a few days',
  };
}

/** Typical wake time (median over the last 14 days) in hours, or null. */
export function typicalWake(d) {
  const hs = d.vitals.map((v) => String(v.sleep_end_local || '').match(/T(\d{2}):(\d{2})/))
    .filter(Boolean).map((m) => +m[1] + +m[2] / 60).sort((a, b) => a - b);
  return hs.length ? hs[Math.floor(hs.length / 2)] : null;
}

/** Tonight's bedtime and a one-line reason. */
export function bedtime(d) {
  const wake = typicalWake(d) ?? 6.5;
  const sleep = metricRow(d, 'sleep_score', d.vitals);
  const ready = metricRow(d, 'training_readiness', d.vitals);
  const behind = sleep.flagged || ready.flagged;
  const need = behind ? C.SLEEP_CATCH_UP_H : C.SLEEP_GOAL_H;
  let bed = wake - need - 0.25; // about 15 minutes to fall asleep
  bed = Math.round(((bed + 24) % 24) * 4) / 4;
  const fmtH = (h) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${hh % 12 || 12}:${pad2(mm)} ${hh < 12 || hh === 24 ? 'AM' : 'PM'}`; };
  const why = behind
    ? `${ready.flagged ? 'Readiness' : 'Sleep'} was below normal this morning. ${need} hours before your usual ${fmtH(wake)} wake-up should bring it back.`
    : `${need} hours of sleep before your usual ${fmtH(wake)} wake-up.`;
  return { time: fmtH(bed), why };
}

/** Text like "3×10" or "3×40s" for a workout step (garmin-coach schema). */
export function stepPlan(s) {
  const n = (v) => (typeof v === 'object' && v ? v.tyler ?? Object.values(v)[0] : v);
  const side = s.per_side ? '/side' : '';
  if (s.type === 'hold') return `${s.sets ?? 1}×${n(s.seconds)}s${side}`;
  return `${s.sets ?? 1}×${n(s.reps)}${side}`;
}
export const liftSteps = (w) => (w?.steps || []).filter((s) => s.type !== 'cooldown');

/**
 * How fresh the data is: when the Mac's last refresh finished (any part that
 * worked) and which parts failed on their latest try, in plain words.
 */
const PART_NAMES = { garmin: 'Garmin', workout: 'workout status', weather: 'weather', snow: 'Sundance' };
export function dataStatus(d) {
  const runs = d.runs.filter((r) => r.job === 'refresh');
  const okTimes = runs.filter((r) => r.ok && r.finished_at).map((r) => Date.parse(r.finished_at));
  const failed = runs.filter((r) => r.ok === false && PART_NAMES[r.part]).map((r) => PART_NAMES[r.part]);
  return { updatedAt: okTimes.length ? Math.max(...okTimes) : null, failed };
}
export function watchSync(d) {
  const s = [...d.vitals].reverse().find((v) => v.watch_last_sync)?.watch_last_sync;
  return s ? Date.parse(s) : null;
}

export const CALL_TEXT ={ keep: 'keep the plan', push: 'push harder', ease: 'ease off' };

/**
 * Everything the morning workout card needs, shared by the wall and the phone:
 * the schedule row, the planned and adjusted workouts, Claude's call as a title,
 * text and style, whether to offer the adjusted version, and the status line.
 */
export function workoutToday(d) {
  const s = d.schedule.find((r) => r.date === d.today) || null;
  if (!s || s.status === 'rest') return { s };
  const planned = d.workouts[s.planned_workout_id] || null;
  const rec = d.rec;
  const adjusted = rec?.adjusted_workout_id ? d.workouts[rec.adjusted_workout_id] : null;
  let call;
  if (!rec) {
    call = hourOf() < 6.25
      ? { title: "Claude's call comes at 6:15 AM", text: '', kind: '' }
      : { title: 'No recommendation today', text: 'The plan as written stands.', kind: '' };
  } else if (!rec.vitals_ready) {
    call = { title: "Vitals haven't synced yet", text: `${hourOf() < 8.5 ? 'Claude checks again at 8:30 AM. ' : ''}The plan as written is on your watch.`, kind: '' };
  } else {
    call = { title: `Claude's call: ${CALL_TEXT[rec.call]}`, text: rec.reason || '', kind: rec.call };
  }
  const version = rec?.call === 'push' ? 'harder' : 'easier';
  const offer = !!adjusted && rec?.call !== 'keep' && ['planned', 'sent'].includes(s.status);
  const pending = d.pending.some((a) => ['accept_workout', 'keep_plan'].includes(a.type) && a.date === d.today);
  const status = {
    swapped_in: `The ${version} version is on your watch.`,
    sent: 'The plan as written is on your watch.',
    planned: 'Goes to your watch at 6:15 AM.',
  }[s.status] || '';
  return {
    s, planned, adjusted, rec, call, version, offer, pending, status,
    done: s.status === 'done',
    showAdjusted: offer || s.status === 'swapped_in',
  };
}

// ---------------------------------------------------------------------------
// Charts (inline SVG paths)
// ---------------------------------------------------------------------------
/** Line through values (nulls leave gaps), scaled to w x h, with an optional normal band. */
export function spark(vals, { w = 300, h = 64, lo = null, hi = null, padX = 6, padY = 6, min = null, max = null } = {}) {
  const nums = vals.filter((v) => v != null);
  if (!nums.length) return null;
  let a = min ?? Math.min(...nums, lo ?? Infinity), b = max ?? Math.max(...nums, hi ?? -Infinity);
  if (b === a) { a -= 1; b += 1; }
  if (min == null && max == null) { const s = b - a; a -= s * 0.1; b += s * 0.1; }
  const X = (i) => padX + (i * (w - 2 * padX)) / Math.max(1, vals.length - 1);
  const Y = (v) => h - padY - ((v - a) / (b - a)) * (h - 2 * padY);
  let d = '', pen = false, last = null;
  vals.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `;
    pen = true; last = i;
  });
  return {
    d: d.trim(), X, Y,
    lastX: X(last), lastY: Y(vals[last]),
    band: lo != null && hi != null ? { y: Y(hi), h: Math.max(3, Y(lo) - Y(hi)) } : null,
  };
}
