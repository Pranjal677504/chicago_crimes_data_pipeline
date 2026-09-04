(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const fmt = new Intl.NumberFormat('en-US');
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const colors = ['#156b78', '#2f8993', '#6e9ba2', '#9db9bd', '#c7d7da', '#d8912e'];

  const state = {
    view: 'overview', year: 'all', crime: 'all', district: 'all', community: 'all', domestic: 'all', arrest: 'all',
    from: '', to: '', minPeriod: '', maxPeriod: '',
    trendMode: 'monthly', mapMode: 'clusters'
  };
  const data = {};
  let map = { center: [41.84, -87.68], zoom: 10, dragging: false, last: null, rendered: [], cache: new Map() };

  function number(v) { return Number.isFinite(+v) ? fmt.format(Math.round(+v)) : '—'; }
  function short(v) { return Number.isFinite(+v) ? compact.format(+v) : '—'; }
  function percent(n, d) { return d > 0 ? `${(n / d * 100).toFixed(1)}%` : '—'; }
  function esc(value) { return String(value ?? '—').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
  function metric(total, arrests) { return state.arrest === '1' ? arrests : state.arrest === '0' ? total - arrests : total; }
  function periodKey(year, month) { return `${year}-${String(month).padStart(2, '0')}`; }
  function inPeriod(year, month) { const key = periodKey(year, month); return key >= state.from && key <= state.to; }
  function periodLabel(value) { const [year, month] = value.split('-'); return `${months[+month - 1]} ${year}`; }
  function isPartialYear(year) { return year === Math.max(...data.core.years) && new Date(data.core.meta.maxDate).getMonth() < 11; }
  function showToast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(showToast.t); showToast.t = setTimeout(() => el.classList.remove('show'), 2400); }
  function showTip(event, title, lines = []) { const el = $('#tooltip'); el.innerHTML = `<strong>${esc(title)}</strong>${lines.map(x => `<div>${x}</div>`).join('')}`; el.classList.add('show'); moveTip(event); }
  function moveTip(event) { const el = $('#tooltip'); const x = Math.min(innerWidth - 270, event.clientX + 14); const y = Math.min(innerHeight - 110, event.clientY + 14); el.style.left = `${Math.max(8, x)}px`; el.style.top = `${Math.max(8, y)}px`; }
  function hideTip() { $('#tooltip').classList.remove('show'); }

  function currentRows(source = data.monthlyGeo.rows) {
    return source.filter(r =>
      inPeriod(r[0], r[1]) &&
      (state.year === 'all' || r[0] === +state.year) &&
      (state.district === 'all' || r[2] === state.district) &&
      (state.community === 'all' || r[3] === state.community) &&
      (state.crime === 'all' || r[4] === state.crime) &&
      (state.domestic === 'all' || r[5] === +state.domestic)
    );
  }

  function geoRows() {
    return data.geoCube.rows.filter(r =>
      (state.year === 'all' || r[0] === +state.year) &&
      (state.district === 'all' || r[1] === state.district) &&
      (state.community === 'all' || r[2] === state.community) &&
      (state.crime === 'all' || r[3] === state.crime) &&
      (state.domestic === 'all' || r[4] === +state.domestic)
    );
  }

  function timeRows() {
    return data.timeCube.rows.filter(r =>
      inPeriod(r[0], r[1]) &&
      (state.year === 'all' || r[0] === +state.year) &&
      (state.crime === 'all' || r[2] === state.crime) &&
      (state.domestic === 'all' || r[3] === +state.domestic)
    );
  }

  function group(rows, keyFn, totalIndex, arrestIndex) {
    const out = new Map();
    rows.forEach(r => {
      const key = keyFn(r); const prev = out.get(key) || [0, 0];
      prev[0] += +r[totalIndex]; prev[1] += +r[arrestIndex]; out.set(key, prev);
    });
    return out;
  }

  function fillSelect(id, values, labelFn = v => v) {
    const el = $(id); values.forEach(v => el.insertAdjacentHTML('beforeend', `<option value="${esc(v)}">${esc(labelFn(v))}</option>`));
  }

  function applyUrlState() {
    const params = new URLSearchParams(location.search);
    ['year', 'crime', 'district', 'community', 'domestic', 'arrest', 'from', 'to'].forEach(k => { if (params.has(k)) state[k] = params.get(k); });
    if (location.hash && ['overview', 'trends', 'geography', 'enforcement'].includes(location.hash.slice(1))) state.view = location.hash.slice(1);
  }

  function updateUrl() {
    const params = new URLSearchParams();
    ['year', 'crime', 'district', 'community', 'domestic', 'arrest'].forEach(k => { if (state[k] !== 'all') params.set(k, state[k]); });
    if (state.from !== state.minPeriod) params.set('from', state.from);
    if (state.to !== state.maxPeriod) params.set('to', state.to);
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}#${state.view}`);
  }

  function initFilters() {
    fillSelect('#yearFilter', data.core.years.slice().reverse());
    fillSelect('#crimeFilter', data.core.crimeTypes);
    fillSelect('#districtFilter', data.core.districts, v => v === 'UNASSIGNED' ? 'Unassigned' : `District ${v}`);
    fillSelect('#communityFilter', data.core.communities, v => `Area ${v}`);
    const controls = { year: '#yearFilter', crime: '#crimeFilter', district: '#districtFilter', community: '#communityFilter', domestic: '#domesticFilter', arrest: '#arrestFilter' };
    $('#dateFrom').min = state.minPeriod; $('#dateFrom').max = state.maxPeriod; $('#dateFrom').value = state.from;
    $('#dateTo').min = state.minPeriod; $('#dateTo').max = state.maxPeriod; $('#dateTo').value = state.to;
    Object.entries(controls).forEach(([key, id]) => {
      $(id).value = state[key];
      $(id).addEventListener('change', e => {
        state[key] = e.target.value;
        if (key === 'year' && state.year !== 'all') {
          state.from = `${state.year}-01`; state.to = `${state.year}-12` > state.maxPeriod ? state.maxPeriod : `${state.year}-12`;
          $('#dateFrom').value = state.from; $('#dateTo').value = state.to;
        }
        updateUrl(); updateAll();
      });
    });
    const setRange = (key, value) => {
      state[key] = value;
      if (state.from > state.to) { if (key === 'from') state.to = state.from; else state.from = state.to; $('#dateFrom').value = state.from; $('#dateTo').value = state.to; }
      state.year = 'all'; $('#yearFilter').value = 'all'; updateUrl(); updateAll();
    };
    $('#dateFrom').addEventListener('change', e => setRange('from', e.target.value)); $('#dateTo').addEventListener('change', e => setRange('to', e.target.value));
    $('#resetFilters').addEventListener('click', () => {
      Object.keys(controls).forEach(key => { state[key] = 'all'; $(controls[key]).value = 'all'; });
      state.from = state.minPeriod; state.to = state.maxPeriod; $('#dateFrom').value = state.from; $('#dateTo').value = state.to;
      updateUrl(); updateAll(); showToast('Filters reset');
    });
  }

  function updateFilterMeta() {
    const labels = {
      year: v => `Year ${v}`, crime: v => v, district: v => `District ${v}`, community: v => `Community ${v}`,
      domestic: v => v === '1' ? 'Domestic' : 'Non-domestic', arrest: v => v === '1' ? 'Arrested' : 'Not arrested'
    };
    const active = Object.keys(labels).filter(k => state[k] !== 'all');
    const chips = active.map(k => [k, labels[k](state[k])]);
    if (state.from !== state.minPeriod || state.to !== state.maxPeriod) chips.unshift(['period', `${periodLabel(state.from)} — ${periodLabel(state.to)}`]);
    $('#filterChips').innerHTML = chips.map(([k, label]) => `<span class="chip">${esc(label)}<button data-clear-filter="${k}" aria-label="Clear ${esc(label)}">×</button></span>`).join('');
    $$('[data-clear-filter]', $('#filterChips')).forEach(btn => btn.addEventListener('click', () => clearFilter(btn.dataset.clearFilter)));
    $('#resetFilters').disabled = !chips.length;
    const rows = currentRows(); let n = 0; rows.forEach(r => n += metric(r[6], r[7]));
    $('#filterScope').textContent = chips.length ? `${number(n)} matching incidents` : 'All verified incidents';
  }

  function clearFilter(key) {
    if (key === 'period') { state.from = state.minPeriod; state.to = state.maxPeriod; $('#dateFrom').value = state.from; $('#dateTo').value = state.to; }
    else { state[key] = 'all'; $(`#${key}Filter`).value = 'all'; }
    updateUrl(); updateAll();
  }

  function kpi(label, value, note, tone = '') { return `<article class="kpi-card" ${tone ? `data-tone="${tone}"` : ''}><div class="kpi-label">${esc(label)}</div><strong class="kpi-value">${esc(value)}</strong><div class="kpi-note">${note}</div></article>`; }

  function overviewMetrics() {
    const rows = currentRows();
    const total = rows.reduce((s, r) => s + metric(r[6], r[7]), 0);
    const byMonth = group(rows, r => `${r[0]}-${String(r[1]).padStart(2, '0')}`, 6, 7);
    const monthEntries = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const latest = monthEntries.at(-1) || ['—', [0, 0]];
    const byType = group(rows, r => r[4], 6, 7);
    const types = [...byType.entries()].map(([name, vals]) => [name, metric(...vals)]).sort((a, b) => b[1] - a[1]);
    const byDistrict = group(rows, r => r[2], 6, 7);
    const districts = [...byDistrict.entries()].map(([name, vals]) => [name, metric(...vals)]).sort((a, b) => b[1] - a[1]);
    const arrests = rows.reduce((s, r) => s + r[7], 0);
    const applicable = rows.reduce((s, r) => s + r[6], 0);
    const yoy = calculateYoY();
    return { rows, total, monthEntries, latest, types, districts, arrests, applicable, yoy };
  }

  function calculateYoY() {
    const rows = data.monthlyGeo.rows.filter(r =>
      (state.district === 'all' || r[2] === state.district) &&
      (state.community === 'all' || r[3] === state.community) &&
      (state.crime === 'all' || r[4] === state.crime) &&
      (state.domestic === 'all' || r[5] === +state.domestic)
    );
    if (!rows.length) return null;
    const years = [...new Set(rows.map(r => r[0]))].sort((a, b) => a - b);
    const target = state.year === 'all' ? +state.to.slice(0, 4) : +state.year;
    const prior = target - 1;
    const targetRows = rows.filter(r => r[0] === target); const priorRows = rows.filter(r => r[0] === prior);
    if (!priorRows.length || !targetRows.length) return null;
    const startMonth = +state.from.slice(0, 4) === target ? +state.from.slice(5, 7) : 1;
    const endMonth = +state.to.slice(0, 4) === target ? +state.to.slice(5, 7) : Math.max(...targetRows.map(r => r[1]));
    const a = targetRows.filter(r => r[1] >= startMonth && r[1] <= endMonth).reduce((s, r) => s + metric(r[6], r[7]), 0);
    const b = priorRows.filter(r => r[1] >= startMonth && r[1] <= endMonth).reduce((s, r) => s + metric(r[6], r[7]), 0);
    return b ? { target, prior, value: (a - b) / b * 100, a, b, months: endMonth - startMonth + 1 } : null;
  }

  function renderOverview() {
    const m = overviewMetrics();
    if (!m.rows.length) { $('#overviewKpis').innerHTML = kpi('No matching records', '—', 'Adjust the active filters.'); return; }
    const latestLabel = m.latest[0] === '—' ? 'Latest month' : `${months[+m.latest[0].slice(5) - 1]} ${m.latest[0].slice(0, 4)}`;
    const yoyValue = m.yoy ? `${m.yoy.value >= 0 ? '+' : ''}${m.yoy.value.toFixed(1)}%` : '—';
    const yoyClass = m.yoy && m.yoy.value < 0 ? 'down' : '';
    $('#overviewKpis').innerHTML = [
      kpi('Total reported crimes', short(m.total), `${number(m.total)} in selected scope`),
      kpi('Latest period', short(metric(...m.latest[1])), latestLabel),
      kpi('Year-over-year', yoyValue, m.yoy ? `<span class="kpi-change ${yoyClass}">${m.yoy.months}-month comparable window</span>` : 'No valid prior-year baseline', m.yoy?.value > 0 ? 'red' : ''),
      kpi('Top crime category', m.types[0]?.[0] || '—', m.types[0] ? `${number(m.types[0][1])} incidents` : 'Not available'),
      kpi('Arrest rate', percent(m.arrests, m.applicable), `${number(m.arrests)} arrests / ${number(m.applicable)} incidents`, 'amber'),
      kpi('Highest-crime district', m.districts[0]?.[0] ? (m.districts[0][0] === 'UNASSIGNED' ? 'Unassigned' : m.districts[0][0]) : '—', m.districts[0] ? `${number(m.districts[0][1])} incidents` : 'Not available')
    ].join('');
    renderMonthlyTrend(m.monthEntries);
    renderTopCategories(m.types, m.total);
    renderMix(m.types, m.total);
    renderInsights(m);
  }

  function svgLine(container, points, options = {}) {
    const el = $(container); if (!points.length) return empty(el);
    const width = Math.max(520, el.clientWidth || 700), height = el.clientHeight || 280;
    const pad = { l: 52, r: 18, t: 15, b: 35 }; const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
    const max = Math.max(...points.map(p => p.value), 1), min = options.zero === false ? Math.min(...points.map(p => p.value)) * .92 : 0;
    const x = i => pad.l + (points.length === 1 ? w / 2 : i / (points.length - 1) * w);
    const y = v => pad.t + h - ((v - min) / Math.max(1, max - min)) * h;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1)},${pad.t + h} L${x(0)},${pad.t + h} Z`;
    const ticks = 4;
    const grid = Array.from({ length: ticks + 1 }, (_, i) => { const val = min + (max - min) * (ticks - i) / ticks; const yy = pad.t + h * i / ticks; return `<line class="gridline" x1="${pad.l}" x2="${width - pad.r}" y1="${yy}" y2="${yy}"/><text class="axis-label" x="${pad.l - 8}" y="${yy + 4}" text-anchor="end">${short(val)}</text>`; }).join('');
    const step = Math.max(1, Math.ceil(points.length / 7));
    const labels = points.map((p, i) => i % step === 0 || i === points.length - 1 ? `<text class="axis-label" x="${x(i)}" y="${height - 9}" text-anchor="middle">${esc(p.label)}</text>` : '').join('');
    const dots = points.map((p, i) => `<circle class="line-point" data-i="${i}" cx="${x(i)}" cy="${y(p.value)}" r="8" fill="transparent"/><circle cx="${x(i)}" cy="${y(p.value)}" r="2.6" fill="var(--blue)"/>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.aria || 'Time series chart')}"><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--blue)" stop-opacity=".2"/><stop offset="1" stop-color="var(--blue)" stop-opacity=".015"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#areaFill)"/><path d="${line}" fill="none" stroke="var(--blue)" stroke-width="2.4" stroke-linejoin="round"/>${dots}${labels}</svg>`;
    $$('.line-point', el).forEach(node => { const p = points[+node.dataset.i]; node.addEventListener('mousemove', e => showTip(e, p.fullLabel || p.label, [`<em>${number(p.value)}</em> incidents`])); node.addEventListener('mouseleave', hideTip); node.addEventListener('click', () => { if (p.year) { state.year = String(p.year); $('#yearFilter').value = state.year; updateUrl(); updateAll(); } }); });
  }

  function empty(el, message = 'No data matches the current selection.') { el.innerHTML = `<div class="empty">${esc(message)}</div>`; }

  function renderMonthlyTrend(entries) {
    let points = entries.map(([key, vals]) => ({ label: `${months[+key.slice(5) - 1]} '${key.slice(2, 4)}`, fullLabel: `${months[+key.slice(5) - 1]} ${key.slice(0, 4)}`, year: +key.slice(0, 4), value: metric(...vals) }));
    if (state.trendMode === 'rolling') points = points.map((p, i, arr) => ({ ...p, value: arr.slice(Math.max(0, i - 2), i + 1).reduce((s, x) => s + x.value, 0) / Math.min(3, i + 1) }));
    svgLine('#monthlyTrend', points, { aria: 'Monthly reported crime trend' });
  }

  function renderTopCategories(types, total) {
    const n = +$('#topN').value; const rows = types.slice(0, n); const max = rows[0]?.[1] || 1;
    $('#topCategories').innerHTML = rows.map(([name, value]) => `<div class="bar-row" data-crime="${esc(name)}" tabindex="0"><span class="bar-label" title="${esc(name)}">${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${value / max * 100}%"></div></div><span class="bar-value">${short(value)}</span></div>`).join('');
    $$('.bar-row[data-crime]', $('#topCategories')).forEach(el => { const name = el.dataset.crime; const v = types.find(x => x[0] === name)?.[1] || 0; el.addEventListener('mousemove', e => showTip(e, name, [`<em>${number(v)}</em> incidents`, `${percent(v, total)} of selection`, 'Click to filter'])); el.addEventListener('mouseleave', hideTip); el.addEventListener('click', () => selectFilter('crime', name)); });
  }

  function renderMix(types, total) {
    const top = types.slice(0, 5); const used = top.reduce((s, x) => s + x[1], 0); const items = [...top, ['Other', Math.max(0, total - used)]];
    let acc = 0; const stops = items.map((x, i) => { const from = total ? acc / total * 100 : 0; acc += x[1]; return `${colors[i]} ${from}% ${total ? acc / total * 100 : 0}%`; });
    $('#crimeDonut').style.background = `conic-gradient(${stops.join(',')})`;
    $('#crimeDonut').innerHTML = `<div><strong>${short(total)}</strong><span>incidents</span></div>`;
    $('#crimeLegend').innerHTML = items.map((x, i) => `<div class="legend-row"><i style="background:${colors[i]}"></i><span>${esc(x[0])}</span><strong>${percent(x[1], total)}</strong></div>`).join('');
  }

  function renderInsights(m) {
    const strongest = m.monthEntries.slice().sort((a, b) => metric(...b[1]) - metric(...a[1]))[0];
    const statements = [];
    if (m.types[0]) statements.push(`<strong>${esc(m.types[0][0])}</strong> is the largest category, accounting for ${percent(m.types[0][1], m.total)} of selected incidents.`);
    if (strongest) statements.push(`<strong>${months[+strongest[0].slice(5) - 1]} ${strongest[0].slice(0, 4)}</strong> has the highest monthly volume at ${number(metric(...strongest[1]))}.`);
    if (m.districts[0]) statements.push(`<strong>District ${esc(m.districts[0][0])}</strong> records the highest volume in the active geographic view.`);
    if (m.yoy) statements.push(`Comparable volume is <strong>${Math.abs(m.yoy.value).toFixed(1)}% ${m.yoy.value >= 0 ? 'higher' : 'lower'}</strong> than ${m.yoy.prior}.`);
    $('#keyInsights').innerHTML = statements.slice(0, 4).map((s, i) => `<div class="insight"><span class="insight-index">0${i + 1}</span><p>${s}</p></div>`).join('');
  }

  function svgBars(container, values, opts = {}) {
    const el = $(container); if (!values.length) return empty(el);
    const width = Math.max(430, el.clientWidth || 600), height = el.clientHeight || 240; const pad = { l: 48, r: 12, t: 14, b: 34 };
    const w = width - pad.l - pad.r, h = height - pad.t - pad.b, max = Math.max(...values.map(x => x.value), 1); const slot = w / values.length, bw = Math.max(5, slot * .62);
    const bars = values.map((p, i) => { const bh = p.value / max * h; const x = pad.l + i * slot + (slot - bw) / 2, y = pad.t + h - bh; const partial = p.partial ? 'opacity=".48" stroke="var(--blue)" stroke-dasharray="3 2"' : ''; return `<rect class="chart-bar" data-i="${i}" x="${x}" y="${y}" width="${bw}" height="${Math.max(1, bh)}" rx="3" fill="${p.highlight ? 'var(--amber)' : 'var(--blue-2)'}" ${partial}/><text class="axis-label" x="${x + bw / 2}" y="${height - 10}" text-anchor="middle">${esc(p.label)}</text>`; }).join('');
    const grid = [0, .5, 1].map(v => { const y = pad.t + h - v * h; return `<line class="gridline" x1="${pad.l}" x2="${width - pad.r}" y1="${y}" y2="${y}"/><text class="axis-label" x="${pad.l - 7}" y="${y + 4}" text-anchor="end">${short(max * v)}</text>`; }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.aria || 'Bar chart')}">${grid}${bars}</svg>`;
    $$('.chart-bar', el).forEach(node => { const p = values[+node.dataset.i]; node.addEventListener('mousemove', e => showTip(e, p.fullLabel || p.label, [`<em>${number(p.value)}</em> incidents${p.partial ? ' · partial year' : ''}`])); node.addEventListener('mouseleave', hideTip); });
  }

  function renderTrends() {
    const rows = currentRows();
    const byYear = group(rows, r => r[0], 6, 7); const annual = [...byYear].map(([year, vals]) => ({ label: String(year), value: metric(...vals), partial: isPartialYear(year) }));
    svgBars('#annualChart', annual, { aria: 'Annual crime volume' });
    const bySeason = group(rows, r => r[1], 6, 7); const season = months.map((label, i) => { const vals = bySeason.get(i + 1) || [0, 0]; const yearCount = new Set(rows.filter(r => r[1] === i + 1).map(r => r[0])).size || 1; return { label, value: metric(...vals) / yearCount }; });
    svgBars('#seasonalChart', season, { aria: 'Average monthly crime profile' });
    const tr = timeRows(); const heat = group(tr, r => `${r[4]}-${r[5]}`, 6, 7); renderHeatmap(heat);
    const geoLimited = state.district !== 'all' || state.community !== 'all';
    $('#timePatternScope').textContent = geoLimited ? 'Date, crime, domestic, and arrest filters are applied. District/community are unavailable at this temporal grain.' : 'All applicable filters are reflected; hover a cell for the exact incident count.';
    const byHour = group(tr, r => r[5], 6, 7); const hours = [...Array(24)].map((_, i) => ({ label: String(i).padStart(2, '0'), fullLabel: `${String(i).padStart(2, '0')}:00`, value: metric(...(byHour.get(i) || [0, 0])) }));
    const peak = hours.slice().sort((a, b) => b.value - a.value)[0]; hours.forEach(x => x.highlight = x === peak); $('#peakHourText').textContent = peak ? `Peak hour: ${peak.fullLabel} (${number(peak.value)} incidents).` : 'Peak hour unavailable.'; svgBars('#hourChart', hours, { aria: 'Crime by hour of day' });
    const byDay = group(tr, r => r[4], 6, 7); svgBars('#weekdayChart', days.map((label, i) => ({ label: label.slice(0, 3), fullLabel: label, value: metric(...(byDay.get(i + 1) || [0, 0])) })), { aria: 'Crime by weekday' });
    renderYoYRanking();
  }

  function renderHeatmap(values) {
    const max = Math.max(...[...values.values()].map(v => metric(...v)), 1); let html = '<div class="heatmap"><span></span>' + [...Array(24)].map((_, h) => `<span class="heat-hour">${String(h).padStart(2, '0')}</span>`).join('');
    days.forEach((day, d) => { html += `<span class="heat-label">${day.slice(0, 3)}</span>`; for (let h = 0; h < 24; h++) { const v = metric(...(values.get(`${d + 1}-${h}`) || [0, 0])); const intensity = v / max; html += `<i class="heat-cell" data-day="${day}" data-hour="${h}" data-value="${v}" style="background:color-mix(in srgb, var(--blue) ${Math.round(12 + intensity * 88)}%, var(--surface))"></i>`; } }); html += '</div>'; $('#timeHeatmap').innerHTML = html;
    $$('.heat-cell', $('#timeHeatmap')).forEach(el => { el.addEventListener('mousemove', e => showTip(e, `${el.dataset.day}, ${String(el.dataset.hour).padStart(2, '0')}:00`, [`<em>${number(el.dataset.value)}</em> incidents`])); el.addEventListener('mouseleave', hideTip); });
  }

  function renderYoYRanking() {
    const base = data.monthlyGeo.rows.filter(r => (state.district === 'all' || r[2] === state.district) && (state.community === 'all' || r[3] === state.community) && (state.crime === 'all' || r[4] === state.crime) && (state.domestic === 'all' || r[5] === +state.domestic));
    const target = state.year === 'all' ? +state.to.slice(0, 4) : +state.year; const prior = target - 1;
    const startMonth = +state.from.slice(0, 4) === target ? +state.from.slice(5, 7) : 1; const endMonth = +state.to.slice(0, 4) === target ? +state.to.slice(5, 7) : 12;
    const relevant = base.filter(r => [target, prior].includes(r[0]) && r[1] >= startMonth && r[1] <= endMonth);
    const grouped = new Map(); relevant.forEach(r => { const key = r[4]; const v = grouped.get(key) || { a: 0, b: 0 }; v[r[0] === target ? 'a' : 'b'] += metric(r[6], r[7]); grouped.set(key, v); });
    let changes = [...grouped].filter(([, v]) => v.b > 0 && v.a + v.b >= 100).map(([name, v]) => [name, (v.a - v.b) / v.b * 100, v]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10);
    if (!changes.length) return empty($('#yoyRanking'));
    const cap = Math.max(...changes.map(x => Math.abs(x[1])), 1);
    $('#yoyRanking').innerHTML = changes.map(([name, ch]) => `<div class="div-row"><span class="bar-label" title="${esc(name)}">${esc(name)}</span><div class="div-track"><i class="div-fill ${ch >= 0 ? 'positive' : 'negative'}" style="width:${Math.abs(ch) / cap * 50}%"></i></div><strong style="color:${ch >= 0 ? 'var(--red)' : 'var(--blue)'}">${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%</strong></div>`).join('');
  }

  function selectFilter(key, value) { state[key] = value; $(`#${key}Filter`).value = value; updateUrl(); updateAll(); showToast(`${key === 'crime' ? 'Crime type' : key} filter applied`); }

  function renderGeography() {
    const rows = currentRows(); const byDistrict = group(rows, r => r[2], 6, 7); const ranked = [...byDistrict].map(([name, vals]) => [name, metric(...vals)]).sort((a, b) => b[1] - a[1]); const max = ranked[0]?.[1] || 1;
    $('#districtRanking').innerHTML = ranked.slice(0, 10).map(([name, value]) => `<div class="bar-row" data-district="${esc(name)}" tabindex="0"><span class="bar-label">${name === 'UNASSIGNED' ? 'Unassigned' : `District ${esc(name)}`}</span><div class="bar-track"><div class="bar-fill" style="width:${value / max * 100}%"></div></div><span class="bar-value">${short(value)}</span></div>`).join('');
    $$('[data-district]', $('#districtRanking')).forEach(el => el.addEventListener('click', () => selectFilter('district', el.dataset.district)));
    const hot = data.hotspots.rows; const geocoded = data.hotspots.totalCrime;
    const filtered = state.from !== state.minPeriod || state.to !== state.maxPeriod || ['year', 'crime', 'district', 'community', 'domestic', 'arrest'].some(k => state[k] !== 'all');
    $('#mapScopeDisclosure').textContent = filtered ? 'Active filters update the district ranking and geographic summaries. The coordinate-only Gold hotspot map remains an all-time density view.' : 'The coordinate-only Gold hotspot table provides the all-time map; district rankings use the filter-ready analytical model.';
    const selectedTotal = rows.reduce((sum, r) => sum + metric(r[6], r[7]), 0);
    $('#geoStats').innerHTML = [
      ['Selected incidents', number(selectedTotal)], ['Districts in selection', number(ranked.length)], ['All-time hotspot cells', number(hot.length)], ['All-time coordinate coverage', percent(geocoded, data.core.meta.rowCount)]
    ].map(([label, value]) => `<div class="geo-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
    $('#hotspotTable').innerHTML = hot.slice(0, 12).map((r, i) => `<tr><td>${i + 1}</td><td>${r[0].toFixed(3)}, ${r[1].toFixed(3)}</td><td>${number(r[2])}</td><td>${number(r[3])}</td><td>${(+r[4]).toFixed(1)}%</td></tr>`).join('');
    requestAnimationFrame(renderMap);
  }

  function lon2x(lon, z) { return (lon + 180) / 360 * 256 * 2 ** z; }
  function lat2y(lat, z) { const rad = lat * Math.PI / 180; return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 256 * 2 ** z; }
  function x2lon(x, z) { return x / (256 * 2 ** z) * 360 - 180; }
  function y2lat(y, z) { const n = Math.PI - 2 * Math.PI * y / (256 * 2 ** z); return 180 / Math.PI * Math.atan(.5 * (Math.exp(n) - Math.exp(-n))); }

  function renderMap() {
    if (!data.hotspots) return;
    const canvas = $('#crimeMap'), wrap = $('#mapWrap'); const dpr = Math.min(devicePixelRatio || 1, 2); const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w < 50 || h < 50) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#dce7e8'; ctx.fillRect(0, 0, w, h);
    const z = Math.round(map.zoom), cx = lon2x(map.center[1], z), cy = lat2y(map.center[0], z); const left = cx - w / 2, top = cy - h / 2;
    const minX = Math.floor(left / 256), maxX = Math.floor((left + w) / 256), minY = Math.floor(top / 256), maxY = Math.floor((top + h) / 256);
    let pending = 0;
    for (let tx = minX; tx <= maxX; tx++) for (let ty = minY; ty <= maxY; ty++) {
      const key = `${z}/${tx}/${ty}`; let img = map.cache.get(key);
      if (!img) { img = new Image(); img.crossOrigin = 'anonymous'; img.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`; map.cache.set(key, img); pending++; img.onload = renderMap; }
      if (img.complete && img.naturalWidth) { ctx.globalAlpha = document.documentElement.dataset.theme === 'dark' ? .45 : .78; ctx.drawImage(img, tx * 256 - left, ty * 256 - top, 256, 256); }
    }
    ctx.globalAlpha = 1; drawHotspots(ctx, w, h, z, left, top); $('#mapDensityLegend').classList.toggle('show', state.mapMode === 'heat'); $('#mapNote').textContent = `All-time Gold layer · ${number(map.rendered.length)} visible ${state.mapMode === 'clusters' ? 'clusters' : 'density zones'} · zoom ${z}`;
  }

  function drawHotspots(ctx, w, h, z, left, top) {
    const visible = []; const rows = data.hotspots.rows;
    if (state.mapMode === 'clusters') {
      const buckets = new Map(); rows.forEach(r => { const x = lon2x(r[1], z) - left, y = lat2y(r[0], z) - top; if (x < -30 || x > w + 30 || y < -30 || y > h + 30) return; const key = `${Math.floor(x / 34)}-${Math.floor(y / 34)}`; const b = buckets.get(key) || { x: 0, y: 0, count: 0, arrests: 0, n: 0, lat: 0, lon: 0 }; b.x += x * r[2]; b.y += y * r[2]; b.lat += r[0] * r[2]; b.lon += r[1] * r[2]; b.count += r[2]; b.arrests += r[3]; b.n++; buckets.set(key, b); });
      [...buckets.values()].sort((a, b) => a.count - b.count).forEach(b => { b.x /= b.count; b.y /= b.count; b.lat /= b.count; b.lon /= b.count; const radius = Math.min(22, 5 + Math.sqrt(b.count) * .34); ctx.beginPath(); ctx.arc(b.x, b.y, radius, 0, Math.PI * 2); ctx.fillStyle = 'rgba(21,107,120,.72)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.88)'; ctx.lineWidth = 1.5; ctx.stroke(); if (radius > 11) { ctx.fillStyle = '#fff'; ctx.font = '700 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(short(b.count), b.x, b.y); } visible.push({ ...b, radius }); });
    } else {
      const cellSize = z <= 9 ? 16 : z <= 11 ? 13 : 10;
      const buckets = new Map();
      rows.forEach(r => {
        const x = lon2x(r[1], z) - left, y = lat2y(r[0], z) - top;
        if (x < -30 || x > w + 30 || y < -30 || y > h + 30) return;
        const key = `${Math.floor(x / cellSize)}-${Math.floor(y / cellSize)}`;
        const b = buckets.get(key) || { x: 0, y: 0, count: 0, arrests: 0, lat: 0, lon: 0 };
        b.x += x * r[2]; b.y += y * r[2]; b.lat += r[0] * r[2]; b.lon += r[1] * r[2]; b.count += r[2]; b.arrests += r[3]; buckets.set(key, b);
      });
      const zones = [...buckets.values()].map(b => ({ ...b, x: b.x / b.count, y: b.y / b.count, lat: b.lat / b.count, lon: b.lon / b.count, score: Math.log1p(b.count) }));
      const scores = zones.map(b => b.score).sort((a, b) => a - b); const scaleMax = scores[Math.floor(scores.length * .96)] || 1;
      ctx.save(); ctx.globalCompositeOperation = 'source-over';
      zones.sort((a, b) => a.score - b.score).forEach(b => {
        const intensity = Math.min(1, b.score / scaleMax); const radius = cellSize * (1.15 + intensity * 1.05);
        const color = intensity > .72 ? [197, 63, 74] : intensity > .42 ? [234, 155, 54] : [37, 135, 149];
        const alpha = .18 + intensity * .34; const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, radius);
        g.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${alpha})`);
        g.addColorStop(.48, `rgba(${color[0]},${color[1]},${color[2]},${alpha * .68})`);
        g.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
        ctx.fillStyle = g; ctx.fillRect(b.x - radius, b.y - radius, radius * 2, radius * 2); visible.push({ ...b, radius });
      });
      ctx.restore();
    }
    map.rendered = visible;
  }

  function initMapEvents() {
    const c = $('#crimeMap');
    c.addEventListener('pointerdown', e => { map.dragging = true; map.last = [e.clientX, e.clientY]; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => {
      if (map.dragging) { const z = Math.round(map.zoom); let cx = lon2x(map.center[1], z) - (e.clientX - map.last[0]); let cy = lat2y(map.center[0], z) - (e.clientY - map.last[1]); map.center = [y2lat(cy, z), x2lon(cx, z)]; map.last = [e.clientX, e.clientY]; renderMap(); return; }
      const rect = c.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top; let nearest = null, dist = 26; map.rendered.forEach(p => { const d = Math.hypot(p.x - x, p.y - y); if (d < Math.max(p.radius, 8) && d < dist) { dist = d; nearest = p; } });
      if (nearest) showTip(e, `${nearest.lat.toFixed(3)}, ${nearest.lon.toFixed(3)}`, [`<em>${number(nearest.count)}</em> incidents`, `${number(nearest.arrests)} arrests`, `${percent(nearest.arrests, nearest.count)} arrest rate`]); else hideTip();
    });
    c.addEventListener('pointerup', () => map.dragging = false); c.addEventListener('pointercancel', () => map.dragging = false); c.addEventListener('mouseleave', hideTip);
    c.addEventListener('wheel', e => { e.preventDefault(); map.zoom = Math.max(9, Math.min(15, map.zoom + (e.deltaY < 0 ? 1 : -1))); renderMap(); }, { passive: false });
    $('#mapPlus').onclick = () => { map.zoom = Math.min(15, map.zoom + 1); renderMap(); }; $('#mapMinus').onclick = () => { map.zoom = Math.max(9, map.zoom - 1); renderMap(); }; $('#mapReset').onclick = () => { map.center = [41.84, -87.68]; map.zoom = 10; renderMap(); };
    new ResizeObserver(() => state.view === 'geography' && renderMap()).observe($('#mapWrap'));
  }

  function enforcementRows() {
    const rows = currentRows(); const by = group(rows, r => r[4], 6, 7); return [...by].map(([name, vals]) => [name, vals[0], vals[1]]);
  }

  function renderEnforcement() {
    let rows = enforcementRows(); if (state.arrest === '1') rows = rows.map(r => [r[0], r[2], r[2]]); if (state.arrest === '0') rows = rows.map(r => [r[0], r[1] - r[2], 0]);
    const total = rows.reduce((s, r) => s + r[1], 0), arrests = rows.reduce((s, r) => s + r[2], 0), non = total - arrests;
    const rates = rows.filter(r => r[1] > 0).map(r => ({ name: r[0], total: r[1], arrests: r[2], rate: r[2] / r[1] * 100 }));
    const highest = rates.slice().sort((a, b) => b.rate - a.rate)[0]; const domesticRows = data.monthlyGeo.rows.filter(r => inPeriod(r[0], r[1]) && (state.year === 'all' || r[0] === +state.year) && (state.crime === 'all' || r[4] === state.crime) && (state.district === 'all' || r[2] === state.district) && (state.community === 'all' || r[3] === state.community));
    const domTotals = group(domesticRows, r => r[5], 6, 7); const domesticTotal = metric(...(domTotals.get(1) || [0, 0])); const domesticGrand = [...domTotals.values()].reduce((s, v) => s + metric(...v), 0);
    $('#enforcementKpis').innerHTML = [kpi('Overall arrest rate', percent(arrests, total), `${number(arrests)} arrests / ${number(total)} incidents`), kpi('Arrested incidents', short(arrests), 'Count in selected scope'), kpi('Not arrested', short(non), `${percent(non, total)} of applicable incidents`), kpi('Highest category rate', highest ? `${highest.rate.toFixed(1)}%` : '—', highest?.name || 'Not available', 'amber')].join('');
    let sorted = rates.slice(); const sort = $('#enforcementSort').value; sorted.sort((a, b) => b[sort === 'volume' ? 'total' : sort] - a[sort === 'volume' ? 'total' : sort]); const max = Math.max(...sorted.map(x => x.rate), 1);
    $('#arrestRateBars').innerHTML = sorted.slice(0, 12).map(x => `<div class="bar-row" data-enforce="${esc(x.name)}"><span class="bar-label" title="${esc(x.name)}">${esc(x.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${x.rate / max * 100}%"></div></div><span class="bar-value">${x.rate.toFixed(1)}%</span></div>`).join('');
    $$('[data-enforce]', $('#arrestRateBars')).forEach(el => { const x = rates.find(r => r.name === el.dataset.enforce); el.addEventListener('mousemove', e => showTip(e, x.name, [`<em>${x.rate.toFixed(1)}%</em> arrest rate`, `${number(x.arrests)} arrests / ${number(x.total)} incidents`, 'Click to filter'])); el.addEventListener('mouseleave', hideTip); el.addEventListener('click', () => selectFilter('crime', x.name)); });
    $('#outcomeSplit').innerHTML = `<div class="stack-bar"><i style="width:${arrests / Math.max(total, 1) * 100}%"></i><i style="width:${non / Math.max(total, 1) * 100}%"></i></div><div class="outcome-legend"><div><span>Arrested</span><strong>${number(arrests)} · ${percent(arrests, total)}</strong></div><div style="text-align:right"><span>Not arrested</span><strong>${number(non)} · ${percent(non, total)}</strong></div></div>`;
    $('#domesticSplit').innerHTML = `<h3>Domestic incident share</h3><div class="domestic-bars"><div><div class="outcome-legend"><span>Domestic</span><strong>${percent(domesticTotal, domesticGrand)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${domesticTotal / Math.max(domesticGrand,1)*100}%"></div></div></div></div>`;
    renderScatter(rates); const arrestRank = rates.slice().sort((a, b) => b.arrests - a.arrests).slice(0, 10), am = arrestRank[0]?.arrests || 1; $('#topArrests').innerHTML = arrestRank.map(x => `<div class="bar-row"><span class="bar-label" title="${esc(x.name)}">${esc(x.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${x.arrests / am * 100}%"></div></div><span class="bar-value">${short(x.arrests)}</span></div>`).join('');
  }

  function renderScatter(rows) {
    const el = $('#enforcementScatter'); if (!rows.length) return empty(el); const width = Math.max(520, el.clientWidth || 720), height = el.clientHeight || 330, p = { l: 58, r: 20, t: 16, b: 38 }, w = width - p.l - p.r, h = height - p.t - p.b;
    const xmax = Math.max(...rows.map(x => x.total), 1), ymax = Math.max(...rows.map(x => x.rate), 1); const x = v => p.l + Math.sqrt(v / xmax) * w, y = v => p.t + h - v / ymax * h;
    const grid = [0, .25, .5, .75, 1].map(v => `<line class="gridline" x1="${p.l}" x2="${width - p.r}" y1="${p.t + h - v * h}" y2="${p.t + h - v * h}"/><text class="axis-label" x="${p.l - 8}" y="${p.t + h - v * h + 4}" text-anchor="end">${(ymax * v).toFixed(0)}%</text>`).join('');
    const dots = rows.map((r, i) => `<circle class="scatter-dot" data-i="${i}" cx="${x(r.total)}" cy="${y(r.rate)}" r="${Math.min(12, 4 + Math.sqrt(r.total / xmax) * 10)}" fill="var(--blue)" fill-opacity=".7" stroke="var(--surface)" stroke-width="1.5"/>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Crime volume versus arrest rate scatter plot">${grid}<text class="axis-label" x="${p.l}" y="${height - 8}">Lower volume</text><text class="axis-label" x="${width - p.r}" y="${height - 8}" text-anchor="end">Higher volume →</text>${dots}</svg>`;
    $$('.scatter-dot', el).forEach(n => { const r = rows[+n.dataset.i]; n.addEventListener('mousemove', e => showTip(e, r.name, [`<em>${r.rate.toFixed(1)}%</em> arrest rate`, `${number(r.arrests)} arrests / ${number(r.total)} incidents`])); n.addEventListener('mouseleave', hideTip); n.addEventListener('click', () => selectFilter('crime', r.name)); });
  }

  function renderInventory() {
    const latestYear = Math.max(...data.core.years); const completeThrough = periodLabel(state.maxPeriod);
    $('#methodologySummary').innerHTML = [
      ['Refresh mode', data.core.meta.refreshMode || 'Automated daily pipeline', `Last verified coverage through ${completeThrough}`],
      ['Pipeline volume', number(data.core.meta.rowCount), `${number(data.core.meta.uniqueIds)} unique crime IDs`],
      [`${latestYear} is partial`, 'Comparable periods only', `Coverage ends ${completeThrough}`]
    ].map(([label, value, note]) => `<article class="method-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');
    $('#inventoryContent').innerHTML = data.inventory.files.map(f => `<article class="inventory-card"><h3>${esc(f.filename)}</h3><p><strong>${number(f.rowCount)} rows</strong> · ${esc(f.format)} · Grain: ${esc(f.grain)}</p>${f.rangeStart ? `<p>Range: ${esc(f.rangeStart)} to ${esc(f.rangeEnd)}</p>` : ''}<div class="schema-tags">${f.columns.map(c => `<span>${esc(c.name)} · ${esc(c.type)}</span>`).join('')}</div></article>`).join('');
  }

  function csvDownload(filename, headers, rows) {
    const quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`; const csv = [headers, ...rows].map(r => r.map(quote).join(',')).join('\n'); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); showToast(`${filename} downloaded`);
  }

  function updateAll() {
    updateFilterMeta(); renderOverview(); renderTrends(); renderGeography(); renderEnforcement();
  }

  function switchView(view) {
    state.view = view; $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`)); $$('.nav-item[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    const titles = { overview: 'Citywide overview', trends: 'Trends & time', geography: 'Geographic concentration', enforcement: 'Arrest & enforcement outcomes' }; $('#pageTitle').textContent = titles[view]; $('#breadcrumb').textContent = `ANALYTICS / ${view === 'trends' ? 'TRENDS & TIME' : view.toUpperCase()}`; updateUrl(); document.body.classList.remove('mobile-nav-open'); $('#sidebar').classList.remove('mobile-open'); if (view === 'geography') setTimeout(renderMap, 30);
  }

  function drawer(id, open) { const el = $(id); el.classList.toggle('open', open); el.setAttribute('aria-hidden', String(!open)); $('#drawerBackdrop').classList.toggle('open', open); if (open) setTimeout(() => $('button, input, select', el)?.focus(), 80); }

  function bindUi() {
    $$('.nav-item[data-view]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    $('#collapseSidebar').onclick = () => { const collapsed = document.body.classList.toggle('sidebar-collapsed'); $('#collapseSidebar').textContent = collapsed ? '›' : '‹'; $('#collapseSidebar').setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar'); $('#collapseSidebar').title = collapsed ? 'Expand sidebar' : 'Collapse sidebar'; }; $('#mobileMenu').onclick = () => $('#sidebar').classList.toggle('mobile-open');
    $('#themeToggle').onclick = () => { const dark = document.documentElement.dataset.theme === 'dark'; document.documentElement.dataset.theme = dark ? '' : 'dark'; localStorage.setItem('cca-theme', dark ? 'light' : 'dark'); renderMap(); };
    $$('[data-trend-mode]').forEach(b => b.onclick = () => { state.trendMode = b.dataset.trendMode; $$('[data-trend-mode]').forEach(x => x.classList.toggle('active', x === b)); renderOverview(); });
    $$('[data-map-mode]').forEach(b => b.onclick = () => { state.mapMode = b.dataset.mapMode; $$('[data-map-mode]').forEach(x => x.classList.toggle('active', x === b)); renderMap(); });
    $('#topN').onchange = renderOverview; $('#enforcementSort').onchange = renderEnforcement;
    $$('[data-open-inventory]').forEach(button => button.onclick = () => drawer('#inventoryDrawer', true)); $('#closeInventory').onclick = () => drawer('#inventoryDrawer', false); $('#drawerBackdrop').onclick = () => drawer('#inventoryDrawer', false);
    $('#exportDistricts').onclick = () => { const g = group(currentRows(), r => r[2], 6, 7); csvDownload('chicago-crime-district-summary.csv', ['district', 'incidents', 'arrests', 'arrest_rate'], [...g].map(([d, v]) => [d, metric(...v), v[1], percent(v[1], v[0])]).sort((a, b) => b[1] - a[1])); };
    addEventListener('resize', () => { clearTimeout(bindUi.resize); bindUi.resize = setTimeout(() => { renderOverview(); renderTrends(); renderEnforcement(); if (state.view === 'geography') renderMap(); }, 180); });
    addEventListener('keydown', e => { if (e.key === 'Escape') { drawer('#inventoryDrawer', false); hideTip(); } });
  }

  async function loadJson(name) { const r = await fetch(`data/${name}.json`); if (!r.ok) throw new Error(`${name} could not be loaded`); return r.json(); }

  async function init() {
    try {
      applyUrlState(); if (localStorage.getItem('cca-theme') === 'dark') document.documentElement.dataset.theme = 'dark';
      const [core, geoCube, monthlyGeo, timeCube, hotspots, inventory] = await Promise.all(['core', 'geo_cube', 'monthly_geo', 'time_cube', 'hotspots', 'inventory'].map(loadJson));
      Object.assign(data, { core, geoCube, monthlyGeo, timeCube, hotspots, inventory });
      state.minPeriod = core.meta.minDate.slice(0, 7); state.maxPeriod = core.meta.maxDate.slice(0, 7); state.from = state.from || state.minPeriod; state.to = state.to || state.maxPeriod;
      if (state.from < state.minPeriod) state.from = state.minPeriod; if (state.to > state.maxPeriod) state.to = state.maxPeriod; if (state.from > state.to) { state.from = state.minPeriod; state.to = state.maxPeriod; }
      const coverageDate = new Date(`${core.meta.maxDate.slice(0, 10)}T00:00:00`);
      $('#freshnessDate').textContent = `Coverage through ${coverageDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      $('#sideCoverage').textContent = `${core.years[0]} — ${core.years.at(-1)}`; $('#sideRows').textContent = `${short(core.meta.rowCount)} verified incidents`;
      initFilters(); bindUi(); initMapEvents(); renderInventory(); $('#loadingState').classList.add('hidden'); switchView(state.view); updateAll();
    } catch (error) {
      console.error(error); $('#loadingState').innerHTML = `<div class="empty"><div><strong>Dashboard data could not be loaded</strong><br><span>${esc(error.message)}</span></div></div>`;
    }
  }

  init();
})();
