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

const CHEVRON = '<svg class="chev" width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function metricRowHtml(m) {
  return `<a class="metric" href="#health/${m.key}" aria-label="${esc(m.label)} history">
    <div class="metric-text">
      <div class="metric-label">${esc(m.label)}</div>
      <div class="metric-value${m.flagged ? ' flag' : ''}">${esc(m.text)}</div>
      <div class="metric-normal">${esc(m.normalText ?? m.normal)}</div>
    </div>${sparkSvg(m)}</a>`;
}

const legendRow = (extra = '') =>
  `<div class="legend-row"><span>Last 14 days${extra}</span><span class="legend"><i></i>your normal</span></div>`;

function weekStrip(d) {
  const start = K.weekStartOf(d.today);
  const cells = [];
  for (let i = 0; i < 7; i++) {
    const ds = K.addDays(start, i);
    const s = d.schedule.find((r) => r.date === ds);
    const w = s && d.workouts[s.active_workout_id || s.planned_workout_id];
    let cls = '', status = '';
    if (s?.status === 'done') { cls = 'done'; status = 'Done'; }
    else if (s?.status === 'missed') { cls = 'missed'; status = 'Missed'; }
    if (ds === d.today) { cls += ' today'; status = status || 'Today'; }
    const name = s?.status === 'rest' ? 'Rest' : (w ? K.workoutShort(w.name) : '—');
    cells.push(`<div class="day ${cls}"><div class="day-name">${K.fmtDay(ds)}</div><div class="day-work">${esc(name)}</div><div class="day-status">${esc(status)}</div></div>`);
  }
  return `<a class="week-link" href="#week" aria-label="Open this week's workouts"><div class="week-title">This week <span class="more">See every workout ${CHEVRON}</span></div><div class="week">${cells.join('')}</div></a>`;
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
    <div class="card-head"><div class="card-title">Goals <span class="card-note">${day === 'yest' ? 'yesterday' : 'today'} ${done} of ${total}</span></div><a class="more" href="#goals">History ${CHEVRON}</a></div>
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
    <a class="score" href="#health/sleep_score" aria-label="Sleep score history"><div class="score-num${score.flagged ? ' flag' : ''}">${esc(score.text)}</div>
      <div style="flex-grow:1"><div class="score-label">Sleep score</div>${scoreNote}</div></a>
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
  return `<section class="card"><div class="card-head"><div class="card-title">Goal progress</div><a class="more" href="#goals">History ${CHEVRON}</a></div>${top}
    <div class="week-title" style="margin:4px 0 0;font-size:14px">Last 30 days</div>${bars}</section>`;
}


// ---------------------------------------------------------------------------
// Detail pages: #week[/YYYY-MM-DD], #goals, #health/<metric>
// ---------------------------------------------------------------------------
const page = { period: 30, cache: new Map() };
const PERIODS = [[7, '7D'], [30, '30D'], [90, '90D'], [365, '1Y']];

function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'week') return { page: 'week', arg: arg || null };
  if (name === 'goals') return { page: 'goals' };
  if (name === 'health' && K.METRICS[arg]) return { page: 'health', arg };
  return { page: 'home' };
}

/** Loads once per key (kept until the next live update), then re-renders. */
function cached(key, load) {
  const hit = page.cache.get(key);
  if (hit && !hit.stale) return hit;
  // First load shows "Loading…"; after a live update the old data stays up while it refetches
  const entry = { loading: true, value: hit?.value };
  page.cache.set(key, entry);
  load().then((value) => { page.cache.set(key, { value }); render(); })
    .catch((err) => { page.cache.set(key, hit?.value ? { value: hit.value } : { error: K.friendlyError(err) }); render(); });
  return entry;
}

function pageHead(title, sub = '') {
  return `<header class="page-head"><a class="back" href="#">${BACK} Today</a>
    <div class="page-title">${esc(title)}</div>${sub ? `<div class="head-sub">${sub}</div>` : ''}</header>`;
}
const BACK = '<svg width="9" height="15" viewBox="0 0 9 15" aria-hidden="true"><path d="M7.5 1.5l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const waiting = (c) => c.error ? `<section class="card"><div class="empty">${esc(c.error)}</div></section>` : '<section class="card"><div class="empty">Loading…</div></section>';
const dayLong = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
const dayShortFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const fmtDs = (ds, f = dayShortFmt) => f.format(new Date(ds + 'T12:00:00Z'));

function renderPage(r) {
  let html;
  if (r.page === 'week') html = weekPage(r.arg || K.weekStartOf(data.today));
  else if (r.page === 'goals') html = goalsPage();
  else html = healthPage(r.arg);
  app.innerHTML = html;
}

// --- Week -------------------------------------------------------------------
const STATUS_LABEL = { done: 'Done', missed: 'Missed', sent: 'On your watch', swapped_in: 'Adjusted version on watch', planned: 'Planned', rest: 'Rest' };

function weekPage(start) {
  const end = K.addDays(start, 6);
  const thisWeek = K.weekStartOf(data.today);
  const label = start === thisWeek ? 'This week' : start === K.addDays(thisWeek, 7) ? 'Next week' : start === K.addDays(thisWeek, -7) ? 'Last week' : `Week of ${fmtDs(start)}`;
  const nav = `<div class="week-nav">
      <button type="button" class="icon-btn" data-action="week-prev" aria-label="Previous week">${BACK}</button>
      <div class="week-range"><b>${esc(label)}</b><span>${esc(fmtDs(start))} to ${esc(fmtDs(end))}</span></div>
      <button type="button" class="icon-btn flip" data-action="week-next" aria-label="Next week">${BACK}</button></div>`;
  const c = cached(`week:${start}`, () => K.loadWeek(start));
  if (!c.value) return pageHead('Workouts') + nav + waiting(c);
  const { schedule, workouts } = c.value;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const ds = K.addDays(start, i);
    const s = schedule.find((x) => x.date === ds);
    const w = s && workouts[s.active_workout_id || s.planned_workout_id];
    const isToday = ds === data.today;
    let status = s ? (STATUS_LABEL[s.status] || s.status) : '';
    if (s && s.status === 'planned' && ds < data.today) status = 'Not logged';
    let body;
    if (!s) body = '<div class="empty">Nothing planned.</div>';
    else if (s.status === 'rest') body = '<div class="empty">Rest day.</div>';
    else {
      const st = s.stats || {};
      const stats = s.status === 'done' ? `<div class="tiles four" style="margin-top:4px">${[
        ['Duration', st.duration_s ? `${Math.round(st.duration_s / 60)} min` : '—'], ['Avg HR', K.num(st.avg_hr)],
        ['Calories', K.num(st.kcal)], ['Sets', st.sets_done != null ? `${st.sets_done} of ${st.sets_planned ?? '—'}` : '—']]
        .map(([l, v]) => `<div class="tile"><div class="tile-label">${l}</div><div class="tile-value" style="font-size:18px">${esc(v)}</div></div>`).join('')}</div>` : '';
      body = `${liftTable(w, null)}${stats}`;
    }
    days.push(`<section class="card day-card${isToday ? ' is-today' : ''}" id="day-${ds}">
      <div class="card-head"><div><div class="next-label">${esc(fmtDs(ds, dayLong))}${isToday ? ' · Today' : ''}</div>
        <div class="next-name">${esc(s?.status === 'rest' ? 'Rest' : w?.name ?? (s ? 'Workout' : '—'))}${w?.est_minutes ? `<span class="card-note"> · ${Math.round(w.est_minutes)} min</span>` : ''}</div></div>
        ${status ? `<div class="badge status-${esc(s.status)}">${esc(status)}</div>` : ''}</div>${body}</section>`);
  }
  return pageHead('Workouts') + nav + days.join('');
}

// --- Goals ------------------------------------------------------------------
function goalsPage() {
  const n = page.period;
  const from = K.addDays(data.today, -(n - 1));
  const head = pageHead('Goal history') + seg('period', PERIODS, n);
  const c = cached(`checks:${from}`, () => K.loadGoalChecks(from));
  if (!c.value) return head + waiting(c);
  const d = { ...data, checks: c.value };
  const first = data.goalDaily[0]?.date;
  if (!first) return head + '<section class="card"><div class="empty">History starts the first time you check off a goal.</div></section>';

  // Index over the period
  const series = K.goalIndexSeries(data).filter((p) => p.date >= K.addDays(from, -1));
  let index = '';
  if (series.length >= 2) {
    const vals = series.map((p) => p.idx);
    const change = vals[vals.length - 1] - vals[0];
    index = `<section class="card"><div class="card-title">Goal index</div>
      <div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:40px;font-weight:700;line-height:1">${vals[vals.length - 1].toFixed(1)}</span>
      <span class="${change >= 0 ? 'up' : 'down'}" style="font-size:15px">${K.signed(change)} in ${series.length - 1} days</span></div>
      ${lineChart(vals, { dates: series.map((p) => p.date), area: true })}</section>`;
  }

  // Overall: share of expected goals done, per day
  const days = [];
  for (let ds = [from, first].sort()[1]; ds < data.today; ds = K.addDays(ds, 1)) days.push(ds);
  let exp = 0, done = 0, perfect = 0;
  for (const ds of days) {
    const ct = K.goalCount(d, ds);
    exp += ct.total; done += ct.done;
    if (ct.total && ct.done === ct.total) perfect++;
  }
  const overall = `<section class="card"><div class="card-title">All goals</div>
    <div class="tiles three">
      <div class="tile"><div class="tile-label">Done</div><div class="tile-value">${exp ? Math.round((done / exp) * 100) + '%' : '—'}</div><div class="tile-side">of expected</div></div>
      <div class="tile"><div class="tile-label">Perfect days</div><div class="tile-value">${perfect}</div><div class="tile-side">of ${days.length}</div></div>
      <div class="tile"><div class="tile-label">Per day</div><div class="tile-value">${days.length ? (done / days.length).toFixed(1) : '—'}</div><div class="tile-side">goals done</div></div>
    </div><div class="note" style="text-align:left">Finished days only; today counts once it's over.</div></section>`;

  // Each goal: rate, current streak, a calendar of the period
  const goals = data.goals.map((g) => {
    let n2 = 0, dn = 0;
    for (const ds of days) if (K.goalExpected(g, ds)) { n2++; if (K.goalDone(d, g.id, ds)) dn++; }
    // Streak: expected days in a row done, counting back from today (today only once it's done)
    const all = { checks: [...c.value, ...data.checks] };
    const earliest = [first, [from, K.addDays(data.today, -31)].sort()[0]].sort()[1];
    let streak = 0;
    for (let ds = data.today; ds >= earliest; ds = K.addDays(ds, -1)) {
      if (!K.goalExpected(g, ds)) continue;
      if (K.goalDone(all, g.id, ds)) streak++;
      else if (ds !== data.today) break;
    }
    const pct = n2 ? Math.round((dn / n2) * 100) : null;
    return `<div class="goal-hist">
      <div class="goal-hist-head"><b>${esc(g.name)}</b><span>${pct == null ? '—' : pct + '%'}${streak ? ` · ${streak}-day streak` : ''}</span></div>
      ${goalCalendar(d, g, from, first)}</div>`;
  }).join('');
  const legend = `<div class="cal-legend"><span><i class="c-done"></i>Done</span><span><i class="c-miss"></i>Missed</span><span><i class="c-off"></i>Day off</span></div>`;
  return head + index + overall + `<section class="card"><div class="card-head"><div class="card-title">Each goal</div></div>${legend}${goals}</section>`;
}

/** A goal's days in the period: a row of squares (30 days or fewer) or a week-by-week grid. */
function goalCalendar(d, g, from, first) {
  const cell = (ds) => {
    if (ds > data.today) return '<i class="c-none"></i>';
    if (ds < first) return '<i class="c-pre"></i>';
    if (!K.goalExpected(g, ds)) return `<i class="c-off" title="${esc(fmtDs(ds))}: day off"></i>`;
    const on = K.goalDone(d, g.id, ds);
    if (ds === data.today && !on) return `<i class="c-today" title="Today"></i>`;
    return `<i class="${on ? 'c-done' : 'c-miss'}" title="${esc(fmtDs(ds))}: ${on ? 'done' : 'missed'}"></i>`;
  };
  if (page.period <= 30) {
    const cells = [];
    for (let ds = from; ds <= data.today; ds = K.addDays(ds, 1)) cells.push(cell(ds));
    return `<div class="cal-row" style="--n:${cells.length}">${cells.join('')}</div>`;
  }
  const cells = [];
  for (let ds = K.weekStartOf(from); ds <= K.addDays(K.weekStartOf(data.today), 6); ds = K.addDays(ds, 1)) cells.push(ds < from ? '<i class="c-none"></i>' : cell(ds));
  return `<div class="cal-grid" style="--cols:${Math.ceil(cells.length / 7)}">${cells.join('')}</div>`;
}

// --- Health -----------------------------------------------------------------
function healthPage(key) {
  const def = K.METRICS[key];
  const n = page.period;
  const from = K.addDays(data.today, -(n - 1));
  const head = pageHead(def.label) + seg('period', PERIODS, n);
  const c = cached(`metric:${key}:${from}`, () => K.loadMetric(key, from));
  if (!c.value) return head + waiting(c);
  const byDate = Object.fromEntries(c.value.map((r) => [r.date, r.value]));
  const dates = [], vals = [];
  for (let ds = from; ds <= data.today; ds = K.addDays(ds, 1)) { dates.push(ds); vals.push(byDate[ds] ?? null); }
  const have = vals.filter((v) => v != null);
  const r = data.ranges[key];
  const lo = r ? +r.low : null, hi = r ? +r.high : null;
  if (!have.length) return head + '<section class="card"><div class="empty">No data for this period yet.</div></section>';
  const avg = have.reduce((a, b) => a + b, 0) / have.length;
  const better = def.worse === 'high' ? Math.min : Math.max, worse = def.worse === 'high' ? Math.max : Math.min;
  const latestI = vals.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
  const inNormal = r ? have.filter((v) => !((def.worse === 'low' && v < lo) || (def.worse === 'high' && v > hi))).length : null;
  const flagged = (v) => r && ((def.worse === 'low' && v < lo) || (def.worse === 'high' && v > hi));
  const tiles = [
    ['Latest', def.fmt(vals[latestI]), fmtDs(dates[latestI])],
    ['Average', def.fmt(avg), `${have.length} days`],
    [def.worse === 'high' ? 'Lowest' : 'Best', def.fmt(better(...have)), ''],
    [def.worse === 'high' ? 'Highest' : 'Lowest', def.fmt(worse(...have)), ''],
  ];
  const summary = `<section class="card">
    <div class="tiles">${tiles.map(([l, v, side]) => `<div class="tile"><div class="tile-label">${l}</div><div class="tile-value" style="font-size:22px">${esc(v)}</div>${side ? `<div class="tile-side">${esc(side)}</div>` : ''}</div>`).join('')}</div>
    ${r ? `<div class="sub">Your normal: ${esc(lo === hi ? def.fmt(lo) : `${def.fmt(lo)} to ${def.fmt(hi)}`)}. ${inNormal} of ${have.length} days were ${def.worse === 'high' ? 'at or below' : 'at or above'} it.</div>` : ''}
    ${lineChart(vals, { dates, lo, hi, rolling: n > 30 })}
    ${n > 30 ? '<div class="note" style="text-align:left">Thin line: each day. Thick line: 7-day average.</div>' : ''}</section>`;
  const list = n <= 30 ? `<section class="card"><div class="card-title">Day by day</div><div class="day-list">${dates.map((ds, i) => [ds, vals[i]]).reverse().map(([ds, v]) =>
    `<div><span>${esc(fmtDs(ds, dayLong))}</span><b class="${v != null && flagged(v) ? 'flag' : ''}">${v == null ? '—' : esc(def.fmt(v))}</b></div>`).join('')}</div></section>` : '';
  return head + summary + list;
}

/** A full-width line chart with dates under it; optional normal band, shaded area or 7-day average. */
function lineChart(vals, { dates, lo = null, hi = null, area = false, rolling = false } = {}) {
  const W = 320, H = 150;
  const s = K.spark(vals, { w: W, h: H, lo, hi, padX: 4, padY: 8 });
  if (!s) return '';
  const nums = vals.filter((v) => v != null);
  let avgPath = '';
  if (rolling) {
    const avg = vals.map((_, i) => {
      const win = vals.slice(Math.max(0, i - 6), i + 1).filter((v) => v != null);
      return win.length >= 3 ? win.reduce((a, b) => a + b, 0) / win.length : null;
    });
    let pen = false;
    avg.forEach((v, i) => { if (v == null) { pen = false; return; } avgPath += `${pen ? 'L' : 'M'}${s.X(i).toFixed(1)} ${s.Y(v).toFixed(1)} `; pen = true; });
  }
  const areaPath = area ? `<path d="${s.d} L${s.X(vals.length - 1).toFixed(1)} ${H} L${s.X(0).toFixed(1)} ${H} Z" fill="var(--accent-soft)"/>` : '';
  const mid = dates[Math.floor(dates.length / 2)];
  return `<div class="line-chart"><svg class="chart tall" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chart from ${esc(fmtDs(dates[0]))} to ${esc(fmtDs(dates[dates.length - 1]))}, from ${esc(String(Math.round(Math.min(...nums))))} to ${esc(String(Math.round(Math.max(...nums))))}">
      ${s.band ? `<rect x="0" y="${s.band.y.toFixed(1)}" width="${W}" height="${s.band.h.toFixed(1)}" fill="var(--band)"/>` : ''}
      ${areaPath}
      <path d="${s.d}" fill="none" stroke="${rolling ? '#9CA3AF' : 'var(--accent)'}" stroke-width="${rolling ? 1.5 : 2.5}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      ${avgPath ? `<path d="${avgPath.trim()}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ''}
    </svg></div>
    <div class="chart-foot"><span>${esc(fmtDs(dates[0]))}</span><span>${esc(fmtDs(mid))}</span><span>${esc(fmtDs(dates[dates.length - 1]))}</span></div>`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function render() {
  if (!data) return;
  const r = route();
  if (r.page !== 'home') { renderPage(r); return; }
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
    if (action === 'period') { page.period = +el.dataset.value; render(); return; }
    if (action === 'week-prev' || action === 'week-next') {
      const start = K.addDays(route().arg || K.weekStartOf(data.today), action === 'week-prev' ? -7 : 7);
      location.hash = `#week/${start}`;
      return;
    }
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
    for (const v of page.cache.values()) v.stale = true;
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

addEventListener('hashchange', () => { scrollTo(0, 0); render(); });

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
