// Phone: one scrolling column, the same data as the wall in the brief's phone order.
// Morning (until 5 PM, and overnight until 6 AM) leads with yesterday's goals and
// recovery; evening (5 PM to midnight) leads with today's goals and activity.
import * as K from './core.js';

const app = document.getElementById('app');
const esc = K.esc;
const SOURCE = 'phone';
let data = null;
let refreshingSince = 0;
let toastTimer = null;
// Switches: null means "follow the time of day"
const view = { goalsDay: null, city: 'slc', mode: null };

const ICON_CHECK = (fill = 'var(--accent)', size = 24) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="13" fill="${fill}"/><path d="M7.5 13.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_OPEN = `<svg width="24" height="24" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11.5" fill="none" stroke="#9CA3AF" stroke-width="2.5"/></svg>`;
const ICON_REFRESH = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function toast(msg) {
  clearTimeout(toastTimer);
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  toastTimer = setTimeout(() => el.remove(), 5000);
}

const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: K.C.TZ, weekday: 'short', month: 'short', day: 'numeric' });

/** The phone has no night screen: overnight it shows the morning view. */
function phoneMode() {
  return K.hourOf() >= 17 ? 'evening' : 'morning';
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
function header(d, mode) {
  const busy = refreshingSince && Date.now() - refreshingSince < 120000;
  const st = K.dataStatus(d);
  const status = busy ? 'Refreshing…'
    : `${st.updatedAt ? `Updated ${esc(K.fmtTime(st.updatedAt))}` : 'Not updated yet'}${st.failed.length ? ` · <span class="flag">${esc(st.failed.join(' and '))} didn't update</span>` : ''}`;
  return `<header class="head">
    <div class="head-date">${esc(shortDate.format(new Date(K.now())))}</div>
    <div class="head-right">
      ${K.testTime ? '<div class="pill test">Test</div>' : ''}
      <div class="pill ${mode}">${mode === 'morning' ? 'Morning' : 'Evening'}</div>
    </div></header>
    <div class="refresh-row"><div class="head-sub">${status}</div>
      <button type="button" class="refresh-btn${busy ? ' busy' : ''}" data-action="refresh"${busy ? ' disabled' : ''}>${ICON_REFRESH}${busy ? 'Refreshing' : 'Refresh'}</button></div>`;
}

const syncNote = (d) => {
  const t = K.watchSync(d);
  return `<div class="card-note">${t ? `Watch synced ${esc(K.fmtTime(t))}` : 'Watch not synced'}</div>`;
};

function seg(action, options, current) {
  return `<div class="seg" role="group">${options.map(([value, label]) =>
    `<button type="button" data-action="${action}" data-value="${value}" aria-pressed="${value === current}">${label}</button>`).join('')}</div>`;
}

function sparkSvg(m, h = 52) {
  const W = 200;
  const s = K.spark(m.series, { w: W, h, lo: m.lo, hi: m.hi, padX: 5, padY: 5 });
  const aria = `${m.label} over the last 14 days, today ${m.text}${m.flagged ? ', outside your normal range' : ''}`;
  if (!s) return `<svg viewBox="0 0 ${W} ${h}" aria-hidden="true"></svg>`;
  return `<svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(aria)}">
    ${s.band ? `<rect x="0" y="${s.band.y.toFixed(1)}" width="${W}" height="${s.band.h.toFixed(1)}" rx="3" fill="var(--band)"/>` : ''}
    <path d="${s.d}" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${m.value != null ? `<circle cx="${s.lastX.toFixed(1)}" cy="${s.lastY.toFixed(1)}" r="4.5" fill="${m.flagged ? 'var(--orange)' : 'var(--accent)'}" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ''}
  </svg>`;
}

function metricRowHtml(m) {
  return `<div class="metric">
    <div class="metric-text">
      <div class="metric-label">${esc(m.label)}</div>
      <div class="metric-value${m.flagged ? ' flag' : ''}">${esc(m.text)}</div>
      <div class="metric-normal">${esc(m.normalText ?? m.normal)}</div>
    </div>${sparkSvg(m)}</div>`;
}

const legendRow = (extra = '') =>
  `<div class="legend-row"><span>Last 14 days${extra}</span><span class="legend"><i></i>your normal</span></div>`;

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

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
function goalsCard(d, mode) {
  const day = view.goalsDay ?? (mode === 'morning' ? 'yest' : 'today');
  const date = day === 'yest' ? d.yest : d.today;
  const { done, total } = K.goalCount(d, date);
  const rows = d.goals.map((g) => {
    const on = K.goalDone(d, g.id, date);
    const off = K.goalOffLabel(g, date);
    const side = off ? `<span class="off-label">${esc(off)}</span>` : !on && day === 'yest' ? '<span class="log">Log it</span>' : '';
    return `<button type="button" class="goal${on ? ' done' : ''}${off ? ' off' : ''}" data-action="goal" data-goal="${g.id}" data-date="${date}" aria-pressed="${on}">
      ${on ? ICON_CHECK() : ICON_OPEN}<span class="name">${esc(g.name)}</span>${side}</button>`;
  }).join('');
  return `<section class="card">
    <div class="card-head"><div class="card-title">Goals</div><div class="card-note">${day === 'yest' ? 'Yesterday' : 'Today'} ${done} of ${total}</div></div>
    ${seg('goals-day', [['yest', 'Yesterday'], ['today', 'Today']], day)}
    <div class="goals">${rows}</div></section>`;
}

function snowCard(snow) {
  const baseChange = snow.baseChange ? `<div class="tile-side ${snow.baseChange > 0 ? 'up' : ''}">${snow.baseChange > 0 ? 'up' : 'down'} ${K.num(Math.abs(snow.baseChange))}</div>` : '<div class="tile-side">&nbsp;</div>';
  const newLifts = snow.newlyOpen.length ? `<div class="tile-side up">${snow.newlyOpen.length} new</div>` : '<div class="tile-side">&nbsp;</div>';
  const outlook = snow.nextSnow
    ? `<div class="tile-value">${esc(K.num(snow.nextSnow.snow_in))} in</div><div class="tile-side">${esc(snow.nextSnow.day)}</div>`
    : '<div class="tile-value">None</div><div class="tile-side">no snow due</div>';
  const headline = snow.isSnowDay
    ? `<div style="display:flex;align-items:baseline;gap:10px"><div class="big">${esc(K.num(snow.new_snow_in))} in</div><div class="sub">new in 24 hours</div></div>`
    : `<div class="sub">No new snow in the last 24 hours${snow.snow_48h_in ? ` · ${esc(K.num(snow.snow_48h_in))} in over 48 hours` : ''}.</div>`;
  return `<section class="card">
    <div class="card-head" style="align-items:center"><div class="card-title">Sundance</div>${snow.isSnowDay ? '<div class="badge">Snow day</div>' : ''}</div>
    ${headline}
    <a class="webcam" href="${esc(K.C.SUNDANCE_WEBCAMS_PAGE)}" target="_blank" rel="noopener" aria-label="Open the Sundance webcams">
      ${snow.webcam ? `<img src="${esc(snow.webcam)}" alt="Sundance summit webcam" loading="lazy">` : ''}<span>Summit cam · tap for live view</span></a>
    <div class="tiles three">
      <div class="tile"><div class="tile-label">Base</div><div class="tile-value">${esc(K.num(snow.base_in))} in</div>${baseChange}</div>
      <div class="tile"><div class="tile-label">Lifts open</div><div class="tile-value">${snow.lifts_open ?? '—'} of ${snow.lifts_total ?? '—'}</div>${newLifts}</div>
      <div class="tile"><div class="tile-label">Outlook</div>${outlook}</div>
    </div></section>`;
}

function workoutMorning(d) {
  const W = K.workoutToday(d);
  const title = '<div class="card-title">Today\'s workout</div>';
  if (!W.s) {
    return `<section class="card">${title}<div style="font-size:24px;font-weight:700">No workout planned</div>
      <div class="empty">Plan the week with Claude and it will show up here.</div>${weekStrip(d)}</section>`;
  }
  if (W.s.status === 'rest') return `<section class="card">${title}<div style="font-size:24px;font-weight:700">Rest day</div>${weekStrip(d)}</section>`;
  const mins = W.planned?.est_minutes ? `${Math.round(W.planned.est_minutes)} min` : '';
  const callLabel = W.rec?.vitals_ready && W.rec.call ? `<div style="font-size:16px;font-weight:600" class="${W.rec.call === 'ease' ? 'flag' : ''}">${esc(W.rec.call === 'keep' ? 'Keep' : W.rec.call === 'push' ? 'Push harder' : 'Ease off')}</div>` : `<div class="card-note">${mins}</div>`;
  const call = `<div class="call ${W.call.kind}"><div class="call-title">${esc(W.call.title)}</div>${W.call.text ? `<div class="call-text">${esc(W.call.text)}</div>` : ''}</div>`;
  let actions = '';
  if (W.offer) {
    actions = W.pending
      ? '<button type="button" class="btn primary" disabled>Sending to your watch…</button>'
      : `<button type="button" class="btn primary" data-action="accept">Send ${W.version} version to watch</button>
         <button type="button" class="btn" data-action="keep">Keep the plan</button>`;
  }
  const footer = W.done ? `<div class="logged">${ICON_CHECK('var(--green)', 20)} Done</div>`
    : W.status ? `<div class="note">${esc(W.status)}</div>` : '';
  return `<section class="card">${title}
    <div class="card-head"><div style="font-size:24px;font-weight:700">${esc(W.planned?.name ?? 'Workout')}</div>${callLabel}</div>
    ${call}${liftTable(W.planned, W.showAdjusted ? W.adjusted : null, W.rec?.call)}${weekStrip(d)}${actions}${footer}</section>`;
}

function workoutEvening(d) {
  const s = d.schedule.find((r) => r.date === d.today);
  const tomorrow = d.schedule.find((r) => r.date === K.addDays(d.today, 1));
  const w = s && d.workouts[s.active_workout_id || s.planned_workout_id];
  let body;
  if (!s) body = '<div style="font-size:24px;font-weight:700">No workout today</div>';
  else if (s.status === 'rest') body = '<div style="font-size:24px;font-weight:700">Rest day</div>';
  else if (s.status === 'done') {
    const st = s.stats || {};
    const tiles = [['Duration', st.duration_s ? `${Math.round(st.duration_s / 60)} min` : '—'], ['Avg HR', K.num(st.avg_hr)], ['Max HR', K.num(st.max_hr)], ['Calories', K.num(st.kcal)]];
    body = `<div style="font-size:24px;font-weight:700">${esc(w?.name ?? 'Workout')}</div>
      <div class="logged">${ICON_CHECK('var(--green)', 20)} Logged ${esc(K.fmtLocalStamp(st.start_local))}</div>
      <div class="tiles four">${tiles.map(([l, v]) => `<div class="tile"><div class="tile-label">${l}</div><div class="tile-value">${esc(v)}</div></div>`).join('')}</div>
      <div class="sub">Sets: <b style="color:var(--ink)">${st.sets_done ?? '—'} of ${st.sets_planned ?? '—'}</b> planned</div>`;
  } else {
    body = `<div style="font-size:24px;font-weight:700">${esc(w?.name ?? 'Workout')}</div>
      <div class="call"><div class="call-title">Not logged yet</div><div class="call-text">If it isn't logged by bedtime, tomorrow's 6:15 AM check moves it to tomorrow.</div></div>
      ${liftTable(w, null)}`;
  }
  let next = '<div class="next"><div class="next-label">Tomorrow</div><div class="next-name">Nothing planned</div></div>';
  if (tomorrow) {
    const tw = d.workouts[tomorrow.planned_workout_id];
    next = tomorrow.status === 'rest'
      ? '<div class="next"><div class="next-label">Tomorrow</div><div class="next-name">Rest day</div></div>'
      : `<div class="next"><div class="next-label">Tomorrow · Claude checks recovery at 6:15 AM</div>
          <div class="next-name">${esc(tw?.name ?? 'Workout')}${tw?.est_minutes ? ` · ${Math.round(tw.est_minutes)} min` : ''}</div>
          <div class="next-moves">${esc(K.liftSteps(tw).map((x) => x.exercise).join(', '))}</div></div>`;
  }
  return `<section class="card"><div class="card-title">Today's workout</div>${body}${next}${weekStrip(d)}</section>`;
}

const STAGES = [
  ['deep_seconds', 'Deep', '#1E3A8A'], ['light_seconds', 'Light', '#93C5FD'],
  ['rem_seconds', 'REM', '#6366F1'], ['awake_seconds', 'Awake', '#D1D5DB'],
];

function recoveryCard(d) {
  const score = K.metricRow(d, 'sleep_score', d.vitals);
  const rows = ['sleep_seconds', 'hrv_overnight_ms', 'training_readiness', 'resting_hr', 'body_battery_wake'].map((k) => K.metricRow(d, k, d.vitals));
  const v = d.vitals.find((x) => x.date === d.today);
  if (score.value == null && rows.every((r) => r.value == null)) {
    return `<section class="card"><div class="card-head"><div class="card-title">Recovery</div>${syncNote(d)}</div>
      <div class="call"><div class="call-title">Last night's sleep hasn't synced yet</div><div class="call-text">Open Garmin Connect on your phone to sync the watch, then tap refresh.</div></div>
      ${legendRow()}${[score, ...rows].map(metricRowHtml).join('')}</section>`;
  }
  const total = v ? STAGES.reduce((s, [k]) => s + (+v[k] || 0), 0) : 0;
  const stages = total ? `<div>
      <div class="stages" role="img" aria-label="Sleep stages: ${STAGES.map(([k, n]) => `${n} ${K.hm(+v[k] || 0)}`).join(', ')}">${STAGES.map(([k, , c]) =>
        `<div style="width:${(((+v[k] || 0) / total) * 100).toFixed(1)}%;background:${c}"></div>`).join('')}</div>
      <div class="stages-key">${STAGES.map(([k, n, c]) => `<span><i style="background:${c}"></i>${n} ${esc(K.hm(+v[k] || 0))}</span>`).join('')}</div></div>` : '';
  const scoreNote = score.value == null ? '<div class="sub">No sleep score</div>'
    : `<div class="sub${score.flagged ? ' flag' : ''}">${score.flagged ? 'Below normal' : 'Within normal'}${score.lo != null ? ` (${K.num(score.lo)} to ${K.num(score.hi)})` : ''}</div>`;
  return `<section class="card" style="gap:14px"><div class="card-head"><div class="card-title">Recovery</div>${syncNote(d)}</div>
    <div class="score"><div class="score-num${score.flagged ? ' flag' : ''}">${esc(score.text)}</div>
      <div><div class="score-label">Sleep score</div>${scoreNote}</div></div>
    ${stages}${legendRow()}${rows.map(metricRowHtml).join('')}</section>`;
}

function activityCard(d) {
  const rows = ['steps', 'intensity_min', 'active_kcal', 'stress_avg'].map((k) => K.metricRow(d, k, d.activity));
  const todayAct = d.activity.find((a) => a.date === d.today);
  if (todayAct?.intensity_min_week != null) rows[1].normalText = `${K.num(todayAct.intensity_min_week)} this week, goal ${K.num(todayAct.intensity_goal_week ?? 150)}`;
  const bed = K.bedtime(d);
  return `<section class="card" style="gap:14px"><div class="card-head"><div class="card-title">Activity</div>${syncNote(d)}</div>
    ${legendRow()}${rows.map(metricRowHtml).join('')}
    <div class="bed"><div class="bed-head">Tonight</div><div class="bed-time">Bed by ${esc(bed.time)}</div><div class="bed-why">${esc(bed.why)}</div></div></section>`;
}

function weatherCard(d) {
  const city = view.city;
  const w = K.cityTemps(d, city);
  const diff = K.dayDiff(w);
  const r = diff == null ? null : Math.round(diff);
  const headline = r == null ? 'Waiting for weather' : r === 0 ? 'Same as yesterday' : `${Math.abs(r)}° ${r < 0 ? 'colder' : 'warmer'}`;
  const tile = (label, hour) => {
    const t = K.tempAt(w.t, hour), y = K.tempAt(w.y, hour);
    return `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${K.deg(t)}</div><div class="tile-side">yesterday ${K.deg(y)}</div></div>`;
  };
  // Hourly chart, 6 AM to 10 PM, today solid and yesterday dashed, commutes shaded
  const W = 320, H = 130, h0 = 6, h1 = 22;
  const vals = (m) => Array.from({ length: h1 - h0 + 1 }, (_, i) => m[h0 + i] ?? null);
  const today = vals(w.t), yest = vals(w.y);
  const all = [...today, ...yest].filter((v) => v != null);
  let chart = '<div class="empty">No hourly weather yet.</div>';
  if (all.length) {
    const min = Math.min(...all) - 2, max = Math.max(...all) + 2;
    const a = K.spark(today, { w: W, h: H, min, max, padX: 0 });
    const b = K.spark(yest, { w: W, h: H, min, max, padX: 0 });
    const x = (hr) => ((hr - h0) / (h1 - h0)) * W;
    const shade = (from, to) => `<rect x="${x(from).toFixed(1)}" y="0" width="${(x(to) - x(from)).toFixed(1)}" height="${H}" fill="var(--band)"/>`;
    const nowX = K.hourOf() >= h0 && K.hourOf() <= h1 ? x(K.hourOf()) : null;
    chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Hourly temperature in ${city === 'slc' ? 'Salt Lake City' : 'Provo'} today versus yesterday${diff != null ? `, ${esc(K.diffText(diff).toLowerCase())}` : ''}">
        ${shade(7, 8)}${shade(17, 18)}
        <line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" stroke="var(--line)" stroke-width="2" vector-effect="non-scaling-stroke"/>
        ${nowX != null ? `<line x1="${nowX.toFixed(1)}" y1="0" x2="${nowX.toFixed(1)}" y2="${H}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>` : ''}
        ${b ? `<path d="${b.d}" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-dasharray="6 6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : ''}
        ${a ? `<path d="${a.d}" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ''}
      </svg>
      <div class="chart-foot"><span>6a</span><span>10a</span><span>2p</span><span>6p</span><span>10p</span></div>
      <div class="note" style="text-align:left">Solid line today, dashed yesterday, shaded bands are your commute.</div>`;
  }
  return `<section class="card">
    <div class="card-head" style="align-items:center"><div class="card-title">Weather</div>${seg('city', [['slc', 'SLC'], ['provo', 'Provo']], city)}</div>
    <div><div class="big">${esc(headline)}</div>${r ? '<div class="sub">than yesterday, 6 AM to 10 PM</div>' : ''}</div>
    <div class="tiles">${tile('Drive in · 7:15', K.C.COMMUTE.in)}${tile('Drive home · 5:30', K.C.COMMUTE.home)}</div>
    ${chart}</section>`;
}

function progressCard(d) {
  const series = K.goalIndexSeries(d).slice(-31);
  const rates = K.goalRates(d, 30);
  const bars = rates.map((g) => {
    const pct = g.rate == null ? null : Math.round(g.rate * 100);
    return `<div class="rate"><div>${esc(g.name)}</div><div class="rate-bar"><div style="width:${pct ?? 0}%"></div></div><div class="rate-val">${pct == null ? '—' : pct + '%'}</div></div>`;
  }).join('');
  let top;
  if (series.length < 2) {
    top = '<div class="empty">The goal index starts at 100 on your first day of goals and moves after each finished day: up for a good day, a small dip for a missed one.</div>';
  } else {
    const vals = series.map((p) => p.idx);
    const W = 320, H = 130;
    const s = K.spark(vals, { w: W, h: H, padX: 2 });
    const change = vals[vals.length - 1] - vals[0];
    const last = series[series.length - 1];
    const area = `${s.d} L${s.X(vals.length - 1).toFixed(1)} ${H} L${s.X(0).toFixed(1)} ${H} Z`;
    top = `<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:40px;font-weight:700;line-height:1">${vals[vals.length - 1].toFixed(1)}</span>
        <span class="${change >= 0 ? 'up' : 'down'}" style="font-size:15px">${K.signed(change)} in ${series.length - 1} days</span>
        <span class="sub" style="font-size:14px">yesterday ${K.signed(last.delta)}</span></div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Goal index over the last ${series.length - 1} days, now ${vals[vals.length - 1].toFixed(1)}">
        <line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" stroke="var(--line)" stroke-width="2" vector-effect="non-scaling-stroke"/>
        <path d="${area}" fill="var(--accent-soft)"/>
        <path d="${s.d}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      </svg>`;
  }
  return `<section class="card"><div class="card-title">Goal progress</div>${top}
    <div class="week-title" style="margin:4px 0 0;font-size:14px">Last 30 days</div>${bars}</section>`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function render() {
  if (!data) return;
  const d = data;
  const mode = phoneMode();
  if (view.mode !== mode) { view.mode = mode; view.goalsDay = null; }
  const snow = K.snowInfo(d);
  const inSeason = !!snow?.in_season;
  const snowDay = inSeason && snow.isSnowDay;
  const cards = [header(d, mode), goalsCard(d, mode)];
  if (snowDay) cards.push(snowCard(snow));
  if (mode === 'morning') cards.push(workoutMorning(d), recoveryCard(d), weatherCard(d), progressCard(d));
  else cards.push(workoutEvening(d), activityCard(d), weatherCard(d), progressCard(d));
  if (inSeason && !snowDay) cards.push(snowCard(snow));
  app.innerHTML = cards.join('');
}

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !data) return;
  const action = el.dataset.action;
  try {
    if (action === 'goals-day') { view.goalsDay = el.dataset.value; render(); return; }
    if (action === 'city') { view.city = el.dataset.value; render(); return; }
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
    } else if (action === 'accept' || action === 'keep') {
      await K.requestAction(action === 'accept' ? 'accept_workout' : 'keep_plan');
      await reload();
    }
  } catch (err) {
    console.error(err);
    toast(`Couldn't save that. ${K.friendlyError(err)}`);
    await reload();
  }
});

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
    if (data) toast(`Couldn't load new data. ${K.friendlyError(err)}`);
    else app.innerHTML = `<div class="login"><h1>Couldn't load the dashboard</h1><p class="login-error">${esc(K.friendlyError(err))}</p></div>`;
  } finally {
    loading = false;
  }
}

async function start() {
  if (!(await K.session())) await K.signInForm(app, { title: 'Dashboard' });
  await reload();
  K.subscribe(reload);
  let lastDate = K.localDate(), lastMode = phoneMode();
  setInterval(() => {
    const ds = K.localDate(), m = phoneMode();
    if (ds !== lastDate) { lastDate = ds; reload(); return; }
    if (m !== lastMode) { lastMode = m; render(); }
  }, 30000);
  // Opening the app again (or switching back to it): live updates stop while a
  // phone app is in the background, so fetch everything fresh.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(); });
  addEventListener('pageshow', (e) => { if (e.persisted) reload(); });
}

start();
