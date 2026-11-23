// Wall screen (Dragon Touch, 1920x1080 landscape). Morning 6-17, evening 17-22, night 22-6.
import * as K from './core.js';

const stage = document.getElementById('stage');
let data = null;
let wakeUntil = 0;          // night: a tap shows the current view for 60 seconds
let refreshingSince = 0;    // refresh tapped; spinner until the listener finishes
let toastTimer = null;
const SOURCE = 'wall';

// ---------------------------------------------------------------------------
// Scale the 1920x1080 design to the window
// ---------------------------------------------------------------------------
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `scale(${s})`;
  stage.style.left = `${(innerWidth - 1920 * s) / 2}px`;
  stage.style.top = `${(innerHeight - 1080 * s) / 2}px`;
}
addEventListener('resize', fit);

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------
const esc = K.esc;
const ICON_CHECK = (fill = 'var(--accent)', size = 28) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="13" fill="${fill}"/><path d="M7.5 13.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_OPEN = `<svg width="28" height="28" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11.5" fill="none" stroke="#9CA3AF" stroke-width="2.5"/></svg>`;
const ICON_REFRESH = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_X = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const ICON_CHEVRON = `<svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true"><path d="M2 2l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function toast(msg) {
  clearTimeout(toastTimer);
  let el = stage.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); stage.appendChild(el); }
  el.textContent = msg;
  toastTimer = setTimeout(() => el.remove(), 5000);
}

function metricRowHtml(m) {
  const s = K.spark(m.series, { w: 300, h: 64, lo: m.lo, hi: m.hi });
  const aria = `${m.label} over the last 14 days, today ${m.text}${m.flagged ? ', outside your normal range' : ''}`;
  const svg = s ? `<svg width="300" height="64" viewBox="0 0 300 64" role="img" aria-label="${esc(aria)}">
      ${s.band ? `<rect x="0" y="${s.band.y.toFixed(1)}" width="300" height="${s.band.h.toFixed(1)}" rx="4" fill="var(--band)"/>` : ''}
      <path d="${s.d}" fill="none" stroke="var(--faint)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${m.value != null ? `<circle cx="${s.lastX.toFixed(1)}" cy="${s.lastY.toFixed(1)}" r="5.5" fill="${m.flagged ? 'var(--orange)' : 'var(--accent)'}" stroke="#fff" stroke-width="2"/>` : ''}
    </svg>` : '<svg width="300" height="64" aria-hidden="true"></svg>';
  return `<div class="metric">
    <div class="metric-text">
      <div class="metric-label">${esc(m.label)}</div>
      <div class="metric-value${m.flagged ? ' flag' : ''}">${esc(m.text)}</div>
      <div class="metric-normal">${esc(m.normalText ?? m.normal)}</div>
    </div>${svg}</div>`;
}

function weekStrip(d) {
  const monday = K.mondayOf(d.today);
  const cells = [];
  for (let i = 0; i < 7; i++) {
    const ds = K.addDays(monday, i);
    const s = d.schedule.find((r) => r.date === ds);
    const w = s && d.workouts[s.active_workout_id || s.planned_workout_id];
    let cls = '', status = '';
    if (s?.status === 'done') { cls = 'done'; status = 'Done'; }
    else if (s?.status === 'missed') { cls = 'missed'; status = 'Missed'; }
    if (ds === d.today) { cls += ' today'; status = status || 'Today'; }
    const name = s?.status === 'rest' ? 'Rest' : (w ? K.workoutShort(w.name) : '—');
    cells.push(`<div class="day ${cls}"><div class="day-name">${K.fmtDay(ds)}</div><div class="day-work">${esc(name)}</div><div class="day-status">${esc(status)}</div></div>`);
  }
  return `<div><div class="week-title">This week</div><div class="week">${cells.join('')}</div></div>`;
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
function topBar(d, mode, { weatherLine = null } = {}) {
  const t = K.now();
  const sync = [...d.vitals].reverse().find((v) => v.watch_last_sync)?.watch_last_sync;
  const right = [];
  if (weatherLine) right.push(`<div class="top-weather">${weatherLine}</div>`);
  else if (sync) right.push(`<div class="sync">Watch synced ${esc(K.fmtTime(Date.parse(sync)))}</div>`);
  if (K.testTime) right.push('<div class="pill test">Test time</div>');
  right.push(`<div class="pill ${mode}">${mode === 'morning' ? 'Morning' : 'Evening'}</div>`);
  const busy = refreshingSince && Date.now() - refreshingSince < 120000;
  right.push(`<button type="button" class="icon-btn${busy ? ' busy' : ''}" data-action="refresh" aria-label="Refresh data"${busy ? ' disabled' : ''}>${ICON_REFRESH}${busy ? 'Refreshing' : 'Refresh'}</button>`);
  return `<header class="top">
    <div class="top-left"><div class="date">${esc(K.fmtDate(t))}</div><div class="time">${esc(K.fmtTime(t))}</div></div>
    <div class="top-right">${right.join('')}</div></header>`;
}

// ---------------------------------------------------------------------------
// Weather and snow (morning, left column top)
// ---------------------------------------------------------------------------
function weatherSummary(d) {
  const slc = K.cityTemps(d, 'slc');
  const provo = K.cityTemps(d, 'provo');
  return {
    slc, provo,
    diff: K.dayDiff(slc),
    provoDiff: K.dayDiff(provo),
    inT: K.tempAt(slc.t, K.C.COMMUTE.in), inY: K.tempAt(slc.y, K.C.COMMUTE.in),
    homeT: K.tempAt(slc.t, K.C.COMMUTE.home), homeY: K.tempAt(slc.y, K.C.COMMUTE.home),
  };
}

function weatherChart(w) {
  const W = 528, H = 80, h0 = 6, h1 = 22;
  const vals = (m) => Array.from({ length: h1 - h0 + 1 }, (_, i) => m[h0 + i] ?? null);
  const today = vals(w.slc.t), yest = vals(w.slc.y);
  const all = [...today, ...yest].filter((v) => v != null);
  if (!all.length) return '<div class="empty">No hourly weather yet.</div>';
  const min = Math.min(...all) - 2, max = Math.max(...all) + 2;
  const a = K.spark(today, { w: W, h: H, min, max, padX: 0 });
  const b = K.spark(yest, { w: W, h: H, min, max, padX: 0 });
  const x = (hr) => ((hr - h0) / (h1 - h0)) * W;
  const shade = (from, to) => `<rect x="${x(from).toFixed(1)}" y="0" width="${(x(to) - x(from)).toFixed(1)}" height="${H}" fill="var(--band)"/>`;
  const label = `Hourly temperature in Salt Lake City today versus yesterday${w.diff != null ? `, ${K.diffText(w.diff).toLowerCase()}` : ''}`;
  return `<div style="margin-top:auto"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      ${shade(7, 8)}${shade(17, 18)}
      <line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" stroke="var(--line)" stroke-width="2"/>
      ${b ? `<path d="${b.d}" fill="none" stroke="#9CA3AF" stroke-width="2.5" stroke-dasharray="6 6" stroke-linecap="round"/>` : ''}
      ${a ? `<path d="${a.d}" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    </svg>
    <div class="chart-foot"><span>6a</span><span>Today solid, yesterday dashed · commutes shaded</span><span>10p</span></div></div>`;
}

function weatherCard(d, snow) {
  const w = weatherSummary(d);
  const chip = snow?.isSnowDay
    ? `<button type="button" class="chip" data-action="snow-show">Sundance ${esc(K.num(snow.new_snow_in))} in ${ICON_CHEVRON}</button>`
    : (w.provoDiff != null ? `<div class="card-note">Provo · ${esc(K.diffText(w.provoDiff))}</div>` : '');
  const tile = (label, t, y) => `<div class="tile"><div><div class="tile-label">${label}</div><div class="tile-value">${K.deg(t)}</div></div><div class="tile-side">yest. ${K.deg(y)}</div></div>`;
  return `<section class="card">
    <div class="card-head"><div class="card-title">Weather · Salt Lake City</div>${chip}</div>
    <div class="big">${esc(K.diffText(w.diff) ?? 'Waiting for weather')}</div>
    <div class="tiles">${tile('Drive in · 7:15', w.inT, w.inY)}${tile('Drive home · 5:30', w.homeT, w.homeY)}</div>
    ${snow?.isSnowDay && w.provoDiff != null ? `<div class="card-note">Provo · ${esc(K.diffText(w.provoDiff))}</div>` : ''}
    ${weatherChart(w)}
  </section>`;
}

function snowCard(snow) {
  const base = snow.baseChange ? ` <span class="${snow.baseChange > 0 ? 'up' : 'down'}" style="font-size:14px">${snow.baseChange > 0 ? 'up' : 'down'} ${K.num(Math.abs(snow.baseChange))}</span>` : '';
  const lifts = snow.newlyOpen.length ? ` <span class="up" style="font-size:14px">${snow.newlyOpen.length} new</span>` : '';
  const outlook = snow.nextSnow ? `${K.num(snow.nextSnow.snow_in)} in ${snow.nextSnow.day.split(' ')[0]}` : 'No snow';
  return `<section class="card" style="gap:12px;padding:24px 32px">
    <div class="card-head" style="align-items:center">
      <div style="display:flex;align-items:baseline;gap:12px"><div class="card-title">Sundance</div><div style="font-size:30px;font-weight:700">${esc(K.num(snow.new_snow_in))} in</div><div class="card-note">new in 24 hours</div></div>
      <button type="button" class="chip outline" data-action="snow-hide" aria-label="Hide snow and show weather">${ICON_X} Weather</button>
    </div>
    <a class="webcam" href="${esc(K.C.SUNDANCE_WEBCAMS_PAGE)}" target="_blank" rel="noopener" aria-label="Open the Sundance webcams">
      ${snow.webcam ? `<img src="${esc(snow.webcam)}" alt="Sundance summit webcam">` : ''}<span>Summit cam · tap for live</span></a>
    <div class="tiles three">
      <div class="tile" style="display:block"><div class="tile-label">Base</div><div class="tile-value">${esc(K.num(snow.base_in))} in${base}</div></div>
      <div class="tile" style="display:block"><div class="tile-label">Lifts open</div><div class="tile-value">${snow.lifts_open} of ${snow.lifts_total}${lifts}</div></div>
      <div class="tile" style="display:block"><div class="tile-label">Outlook</div><div class="tile-value">${esc(outlook)}</div></div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
function goalsCard(d, date, title) {
  const done = d.goals.filter((g) => K.goalDone(d, g.id, date)).length;
  const isYesterday = date !== d.today;
  const series = K.goalIndexSeries(d);
  const last = series[series.length - 1];
  const idx = isYesterday && last && last.date === date
    ? `<span class="muted" style="font-size:16px">index ${last.idx.toFixed(1)}</span><span class="${last.delta >= 0 ? 'up' : 'down'}" style="font-size:16px">${K.signed(last.delta)}</span>` : '';
  const buttons = d.goals.map((g) => {
    const on = K.goalDone(d, g.id, date);
    return `<button type="button" class="goal${on ? ' done' : ''}" data-action="goal" data-goal="${g.id}" data-date="${date}" aria-pressed="${on}">
      ${on ? ICON_CHECK() : ICON_OPEN}<span>${esc(g.name)}</span>${!on && isYesterday ? '<span class="log">Log it</span>' : ''}</button>`;
  }).join('');
  return `<section class="card">
    <div class="card-head"><div class="card-title">${title}</div><div class="goal-sum"><b>${done} of ${d.goals.length}</b>${idx}</div></div>
    <div class="goal-grid">${buttons}</div></section>`;
}

function goalIndexCard(d) {
  const series = K.goalIndexSeries(d).slice(-31);
  if (series.length < 2) {
    return `<section class="card"><div class="card-head"><div class="card-title">Goal index · 30 days</div></div>
      <div class="empty">The index starts at 100 on your first day of goals and moves after each finished day.</div>${ratesHtml(d)}</section>`;
  }
  const vals = series.map((p) => p.idx);
  const s = K.spark(vals, { w: 528, h: 150, padX: 2 });
  const change = vals[vals.length - 1] - vals[0];
  const area = `${s.d} L${s.X(vals.length - 1).toFixed(1)} 150 L${s.X(0).toFixed(1)} 150 Z`;
  return `<section class="card" style="gap:12px">
    <div class="card-head"><div class="card-title">Goal index · ${series.length - 1} days</div>
      <div class="goal-sum"><b style="font-size:30px">${vals[vals.length - 1].toFixed(1)}</b><span class="${change >= 0 ? 'up' : 'down'}" style="font-size:17px">${K.signed(change)}</span></div></div>
    <svg style="flex-grow:1;min-height:0" width="528" height="150" viewBox="0 0 528 150" preserveAspectRatio="none" role="img" aria-label="Goal index over the last ${series.length - 1} days, now ${vals[vals.length - 1].toFixed(1)}">
      <line x1="0" y1="149" x2="528" y2="149" stroke="var(--line)" stroke-width="2"/>
      <path d="${area}" fill="var(--accent-soft)"/>
      <path d="${s.d}" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>${ratesHtml(d)}</section>`;
}

function ratesHtml(d) {
  const rates = K.goalRates(d, 30);
  return `<div class="rates">${rates.map((g) => `<div><div class="r-label">${esc(g.name)}</div><div class="r-val">${g.rate == null ? '—' : Math.round(g.rate * 100) + '%'}</div></div>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Workout
// ---------------------------------------------------------------------------
const CALL = { keep: 'keep the plan', push: 'push harder', ease: 'ease off' };

function liftTable(planned, adjusted, call) {
  const steps = K.liftSteps(planned);
  if (!steps.length) return '';
  if (!adjusted) {
    return `<div class="lifts two"><div class="th">Exercise</div><div class="th">Plan</div>${steps.map((s) =>
      `<div>${esc(s.exercise)}</div><div class="plan">${esc(K.stepPlan(s))}</div>`).join('')}</div>`;
  }
  const pool = [...K.liftSteps(adjusted)];
  const rows = steps.map((s) => {
    const i = pool.findIndex((a) => a.exercise === s.exercise);
    const a = i >= 0 ? pool.splice(i, 1)[0] : null;
    const plan = K.stepPlan(s), alt = a ? K.stepPlan(a) : '—';
    return `<div>${esc(s.exercise)}</div><div class="plan">${esc(plan)}</div><div class="${alt !== plan ? `changed ${call}` : 'plan'}">${esc(alt)}</div>`;
  }).join('');
  const extra = pool.map((a) => `<div>${esc(a.exercise)}</div><div class="plan">—</div><div class="changed ${call}">${esc(K.stepPlan(a))}</div>`).join('');
  return `<div class="lifts"><div class="th">Exercise</div><div class="th">Plan</div><div class="th">${call === 'push' ? 'Harder' : 'Easier'}</div>${rows}${extra}</div>`;
}

function workoutMorning(d) {
  const s = d.schedule.find((r) => r.date === d.today);
  const head = '<div class="card-title">Today\'s workout</div>';
  if (!s) {
    return `<section class="card tall">${head}<div class="big">No workout planned</div>
      <div class="empty">Plan the week with Claude and it will show up here.</div>${weekStrip(d)}</section>`;
  }
  if (s.status === 'rest') return `<section class="card tall">${head}<div class="big">Rest day</div>${weekStrip(d)}</section>`;
  const planned = d.workouts[s.planned_workout_id];
  const rec = d.rec;
  const adjusted = rec?.adjusted_workout_id ? d.workouts[rec.adjusted_workout_id] : null;
  let call;
  if (!rec) {
    call = K.hourOf() < 6.25
      ? '<div class="call"><div class="call-title">Claude\'s call comes at 6:15 AM</div></div>'
      : '<div class="call"><div class="call-title">No recommendation today</div><div class="call-text">The plan as written stands.</div></div>';
  } else if (!rec.vitals_ready) {
    call = `<div class="call"><div class="call-title">Vitals haven't synced yet</div><div class="call-text">${K.hourOf() < 8.5 ? 'Claude checks again at 8:30 AM. ' : ''}The plan as written is on your watch.</div></div>`;
  } else {
    call = `<div class="call ${rec.call}"><div class="call-title">Claude's call: ${CALL[rec.call]}</div><div class="call-text">${esc(rec.reason || '')}</div></div>`;
  }
  const pending = d.pending.some((a) => ['accept_workout', 'keep_plan'].includes(a.type) && a.date === d.today);
  let footer = '';
  if (s.status === 'swapped_in') footer = `<div class="status-line">The ${rec?.call === 'push' ? 'harder' : 'easier'} version is on your watch.</div>`;
  else if (s.status === 'done') footer = `<div class="logged">${ICON_CHECK('var(--green)', 22)} Done</div>`;
  else if (s.status === 'sent') footer = '<div class="status-line">The plan as written is on your watch.</div>';
  else if (s.status === 'planned') footer = '<div class="status-line">Goes to your watch at 6:15 AM.</div>';
  const offer = adjusted && rec?.call !== 'keep' && ['planned', 'sent'].includes(s.status);
  const buttons = !offer ? '' : pending
    ? '<div class="btn-row"><button type="button" class="btn primary" disabled>Sending to your watch…</button></div>'
    : `<div class="btn-row"><button type="button" class="btn primary" data-action="accept">Send ${rec.call === 'push' ? 'harder' : 'easier'} version</button><button type="button" class="btn" data-action="keep">Keep the plan</button></div>`;
  const mins = planned?.est_minutes ? `${Math.round(planned.est_minutes)} min planned` : '';
  return `<section class="card tall" style="gap:16px">${head}
    <div class="card-head"><div style="font-size:36px;font-weight:700">${esc(planned?.name ?? 'Workout')}</div><div class="card-note" style="font-size:18px">${mins}</div></div>
    ${call}${liftTable(planned, offer || s.status === 'swapped_in' ? adjusted : null, rec?.call)}${footer}${weekStrip(d)}${buttons}</section>`;
}

function workoutEvening(d) {
  const s = d.schedule.find((r) => r.date === d.today);
  const tomorrow = d.schedule.find((r) => r.date === K.addDays(d.today, 1));
  const w = s && d.workouts[s.active_workout_id || s.planned_workout_id];
  let body;
  if (!s) body = '<div class="big">No workout today</div>';
  else if (s.status === 'rest') body = '<div class="big">Rest day</div>';
  else if (s.status === 'done') {
    const st = s.stats || {};
    const tiles = [['Duration', st.duration_s ? `${Math.round(st.duration_s / 60)} min` : '—'], ['Avg HR', K.num(st.avg_hr)], ['Max HR', K.num(st.max_hr)], ['Calories', K.num(st.kcal)]];
    body = `<div class="card-head"><div style="font-size:36px;font-weight:700">${esc(w?.name ?? 'Workout')}</div>
        <div class="logged">${ICON_CHECK('var(--green)', 22)} Logged ${esc(K.fmtLocalStamp(st.start_local))}</div></div>
      <div class="tiles four">${tiles.map(([l, v]) => `<div class="tile" style="display:block"><div class="tile-label">${l}</div><div class="tile-value">${esc(v)}</div></div>`).join('')}</div>
      <div class="status-line" style="font-size:20px">Sets: <b style="color:var(--ink)">${st.sets_done ?? '—'} of ${st.sets_planned ?? '—'}</b> planned</div>`;
  } else {
    body = `<div style="font-size:36px;font-weight:700">${esc(w?.name ?? 'Workout')}</div>
      <div class="call"><div class="call-title">Not logged yet</div><div class="call-text">If it isn't logged by bedtime, tomorrow's 6:15 AM check moves it to tomorrow.</div></div>
      ${liftTable(w, null)}`;
  }
  let next = '<div class="next"><div class="card-title" style="font-size:15px">Tomorrow</div><div class="next-name">Nothing planned</div></div>';
  if (tomorrow) {
    const tw = d.workouts[tomorrow.planned_workout_id];
    next = tomorrow.status === 'rest'
      ? '<div class="next"><div class="card-title" style="font-size:15px">Tomorrow</div><div class="next-name">Rest day</div></div>'
      : `<div class="next"><div class="card-head"><div class="card-title" style="font-size:15px">Tomorrow</div><div class="card-note" style="font-size:15px">Claude checks recovery at 6:15 AM</div></div>
          <div class="next-name">${esc(tw?.name ?? 'Workout')}${tw?.est_minutes ? ` · ${Math.round(tw.est_minutes)} min` : ''}</div>
          <div class="next-moves">${esc(K.liftSteps(tw).map((x) => x.exercise).join(', '))}</div></div>`;
  }
  return `<section class="card tall" style="gap:16px"><div class="card-title">Today's workout</div>${body}${next}<div style="margin-top:auto">${weekStrip(d)}</div></section>`;
}

// ---------------------------------------------------------------------------
// Recovery (morning) and activity (evening)
// ---------------------------------------------------------------------------
function recoveryCard(d) {
  const rows = ['sleep_score', 'sleep_seconds', 'hrv_overnight_ms', 'training_readiness', 'resting_hr', 'body_battery_wake']
    .map((k) => K.metricRow(d, k, d.vitals));
  const noToday = rows.every((r) => r.value == null);
  return `<section class="card tall" style="gap:10px">
    <div class="card-head" style="margin-bottom:4px"><div class="card-title">Recovery · last 14 days</div>
      <div class="legend"><i></i>your normal</div></div>
    ${noToday ? '<div class="call"><div class="call-title" style="font-size:18px">Last night\'s sleep hasn\'t synced yet</div></div>' : ''}
    ${rows.map(metricRowHtml).join('')}</section>`;
}

function activityCard(d) {
  const rows = ['steps', 'intensity_min', 'active_kcal', 'stress_avg'].map((k) => K.metricRow(d, k, d.activity));
  const todayAct = d.activity.find((a) => a.date === d.today);
  if (todayAct?.intensity_min_week != null) rows[1].normalText = `${K.num(todayAct.intensity_min_week)} this week, goal ${K.num(todayAct.intensity_goal_week ?? 150)}`;
  const updated = todayAct?.updated_at ? ` · updated ${K.fmtTime(Date.parse(todayAct.updated_at))}` : '';
  const bed = K.bedtime(d);
  return `<section class="card tall" style="gap:10px">
    <div class="card-head" style="margin-bottom:4px"><div class="card-title">Activity · last 14 days</div><div class="legend"><i></i>your normal${esc(updated)}</div></div>
    ${rows.map(metricRowHtml).join('')}
    <div class="bed"><div class="bed-head"><span>Tonight</span><span>Screen goes dark at 10:00</span></div>
      <div class="bed-time">Bed by ${esc(bed.time)}</div><div class="bed-why">${esc(bed.why)}</div></div></section>`;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function morning(d) {
  const snow = K.snowInfo(d);
  const showSnow = snow?.isSnowDay && snow.in_season && !d.snowDismissed;
  let weatherLine = null;
  if (showSnow) {
    const w = weatherSummary(d);
    weatherLine = `<b>SLC ${esc(K.diffText(w.diff) ?? '')}</b> · drive in ${K.deg(w.inT)}, home ${K.deg(w.homeT)}`;
  }
  return `<div class="wall">${topBar(d, 'morning', { weatherLine })}<div class="grid">
    ${showSnow ? snowCard(snow) : weatherCard(d, snow?.in_season ? snow : null)}
    ${workoutMorning(d)}
    ${recoveryCard(d)}
    ${goalsCard(d, d.yest, "Yesterday's goals")}
  </div></div>`;
}

function evening(d) {
  const slc = K.cityTemps(d, 'slc');
  const h = K.hourOf();
  const nowT = K.tempAt(slc.t, h), thenT = K.tempAt(slc.y, h);
  const weatherLine = nowT != null
    ? `SLC ${K.deg(nowT)} now${thenT != null ? ` · ${esc(K.diffText(nowT - thenT))}` : ''}` : null;
  return `<div class="wall">${topBar(d, 'evening', { weatherLine })}<div class="grid">
    ${goalsCard(d, d.today, "Today's goals")}
    ${workoutEvening(d)}
    ${activityCard(d)}
    ${goalIndexCard(d)}
  </div></div>`;
}

function night() {
  return `<div class="night-view" data-action="wake"><div class="night-clock"><div>${esc(K.clock())}</div><div>Tap to wake</div></div></div>`;
}

function render() {
  if (!data) return;
  let mode = K.modeAt();
  if (mode === 'night' && Date.now() < wakeUntil) mode = K.hourOf() >= 22 ? 'evening' : 'morning';
  document.body.classList.toggle('night', mode === 'night');
  const toastEl = stage.querySelector('.toast');
  stage.innerHTML = mode === 'night' ? night() : mode === 'morning' ? morning(data) : evening(data);
  if (toastEl) stage.appendChild(toastEl);
}

// ---------------------------------------------------------------------------
// Taps
// ---------------------------------------------------------------------------
stage.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !data) return;
  const action = el.dataset.action;
  try {
    if (action === 'wake') { wakeUntil = Date.now() + 60000; render(); return; }
    if (action === 'goal') {
      const id = +el.dataset.goal, date = el.dataset.date;
      const done = !K.goalDone(data, id, date);
      data.checks = data.checks.filter((c) => !(c.goal_id === id && c.date === date)).concat([{ goal_id: id, date, done }]);
      render();
      await K.setGoal(id, date, done, SOURCE);
    } else if (action === 'refresh') {
      refreshingSince = Date.now();
      render();
      await K.requestAction('refresh');
    } else if (action === 'snow-hide' || action === 'snow-show') {
      data.snowDismissed = action === 'snow-hide';
      render();
      await K.setSnowDismissed(data.snowDismissed);
    } else if (action === 'accept' || action === 'keep') {
      await K.requestAction(action === 'accept' ? 'accept_workout' : 'keep_plan');
      await reload();
    }
  } catch (err) {
    console.error(err);
    toast(`Couldn't save that: ${err.message || err}`);
    await reload();
  }
});

// ---------------------------------------------------------------------------
// Loading and live updates
// ---------------------------------------------------------------------------
let loading = false;
async function reload() {
  if (loading) return;
  loading = true;
  try {
    data = await K.loadAll();
    if (refreshingSince && !data.pending.some((a) => a.type === 'refresh')) refreshingSince = 0;
    render();
  } catch (err) {
    console.error(err);
    if (data) toast(`Couldn't load new data: ${err.message || err}`);
    else stage.innerHTML = `<div class="login"><h1>Couldn't load the dashboard</h1><p class="login-error">${esc(err.message || err)}</p></div>`;
  } finally {
    loading = false;
  }
}

async function start() {
  fit();
  if (!(await K.session())) await K.signInForm(stage, { title: 'Wall dashboard' });
  await reload();
  K.subscribe(reload);
  let lastDate = K.localDate(), lastMode = K.modeAt();
  setInterval(() => {
    const ds = K.localDate(), m = K.modeAt();
    if (ds !== lastDate) { lastDate = ds; reload(); return; }
    if (m !== lastMode) lastMode = m;
    if (!document.activeElement || document.activeElement === document.body) render(); // tick the clock
  }, 20000);
  setInterval(reload, 10 * 60000);  // fallback if a live update is missed
  // Switching back from the calendar or scores app: show current data right away
  // (live updates may have been missed while the screen was in the background).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(); });
  setInterval(() => { if (wakeUntil && Date.now() > wakeUntil) { wakeUntil = 0; render(); } }, 2000);
}

start();
