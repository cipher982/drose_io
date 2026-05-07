/* analytics.drose.io mirror — vanilla JS */
(function () {
  const LS_TOKEN = 'drose.analytics.token';
  const state = { token: null, period: '30d', summary: null, insights: null };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, attrs = {}, children = []) => {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    const list = Array.isArray(children) ? children : [children];
    for (const c of list) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  };

  /* ---------- formatting ---------- */
  const fmtN = (n) => {
    if (n == null) return '—';
    const x = Number(n);
    if (x >= 1e6) return (x / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (x >= 1e4) return (x / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    if (x >= 1e3) return x.toLocaleString();
    return String(x);
  };
  const fmtPct = (cur, prev) => {
    if (!prev) return cur > 0 ? { txt: '+∞', cls: 'delta-pos' } : { txt: '·', cls: 'delta-zero' };
    const p = ((cur - prev) / prev) * 100;
    const rounded = Math.round(p);
    if (rounded > 0) return { txt: '▲ ' + rounded + '%', cls: 'delta-pos' };
    if (rounded < 0) return { txt: '▼ ' + Math.abs(rounded) + '%', cls: 'delta-neg' };
    return { txt: '·', cls: 'delta-zero' };
  };
  const fmtAvgTime = (totaltime, visits) => {
    if (!visits) return '0s';
    const sec = Math.round(totaltime / visits);
    if (sec >= 60) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    return sec + 's';
  };

  /* ---------- auth + fetch ---------- */
  async function api(path) {
    const res = await fetch(path, { headers: { Authorization: 'Bearer ' + state.token } });
    if (res.status === 401) {
      localStorage.removeItem(LS_TOKEN);
      state.token = null;
      showLogin('Session expired. Sign in again.');
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      let msg = 'Request failed: ' + res.status;
      try { const body = await res.json(); if (body.error) msg = body.error; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  function showLogin(msg) {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    if (msg) {
      const err = $('#login-err');
      err.textContent = msg;
      err.classList.remove('hidden');
    }
  }
  function showApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
  }

  async function tryLogin(pw) {
    // Validate by hitting a protected endpoint.
    const probe = await fetch('/api/admin/analytics/summary?period=24h', {
      headers: { Authorization: 'Bearer ' + pw },
    });
    if (probe.status === 401) return false;
    if (!probe.ok) throw new Error('Server error ' + probe.status);
    state.token = pw;
    localStorage.setItem(LS_TOKEN, pw);
    // warm cache for current period
    state.summary = probe.status === 200 ? await probe.json() : null;
    return true;
  }

  /* ---------- sparkline ---------- */
  function sparkline(series, opts = {}) {
    const points = (series || []).map((d) => d.y || 0);
    const w = opts.w || 200;
    const h = opts.h || 32;
    const pad = 2;
    if (!points.length) return el('svg', { width: w, height: h });
    const max = Math.max(1, ...points);
    const min = Math.min(0, ...points);
    const range = Math.max(1, max - min);
    const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
    const coord = (i, v) => [pad + i * step, h - pad - ((v - min) / range) * (h - pad * 2)];
    const linePts = points.map((v, i) => coord(i, v));
    const d = linePts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const area = d + ' L ' + (w - pad) + ',' + (h - pad) + ' L ' + pad + ',' + (h - pad) + ' Z';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.innerHTML = `
      <defs>
        <linearGradient id="gradSpark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stop-color="#6366f1" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#gradSpark)"/>
      <path d="${d}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    `;
    return svg;
  }

  /* ---------- render: KPI strip ---------- */
  function renderKPIs(totals, sitesCount) {
    const strip = $('#kpi-strip');
    strip.innerHTML = '';
    const bounceRate = totals.visits ? Math.round((totals.bounces / totals.visits) * 100) : 0;
    const items = [
      { label: 'Page Views', value: fmtN(totals.pageviews), delta: fmtPct(totals.pageviews, totals.prev_pageviews) },
      { label: 'Visitors', value: fmtN(totals.visitors), delta: fmtPct(totals.visitors, totals.prev_visitors) },
      { label: 'Sessions', value: fmtN(totals.visits), delta: null, sub: 'across ' + sitesCount + ' sites' },
      { label: 'Avg Time', value: fmtAvgTime(totals.totaltime, totals.visits), delta: null, sub: 'per visit' },
      { label: 'Bounce Rate', value: bounceRate + '%', delta: null, sub: fmtN(totals.bounces) + ' bounces' },
    ];
    for (const k of items) {
      const deltaEl = k.delta
        ? el('span', { class: k.delta.cls }, [k.delta.txt])
        : null;
      const subText = k.sub ? el('span', {}, [k.sub]) : null;
      strip.appendChild(
        el('div', { class: 'kpi' }, [
          el('div', { class: 'kpi-label' }, [k.label]),
          el('div', { class: 'kpi-value' }, [k.value]),
          el('div', { class: 'kpi-sub' }, [deltaEl, subText].filter(Boolean)),
        ])
      );
    }
  }

  /* ---------- render: sites ---------- */
  function renderSites(sites) {
    const grid = $('#sites-grid');
    grid.innerHTML = '';
    const alive = sites.filter((s) => s.stats && s.stats.pageviews > 0);
    const empty = sites.filter((s) => !s.stats || s.stats.pageviews === 0);
    $('#sites-meta').textContent = alive.length + ' active · ' + empty.length + ' idle';

    const sorted = [...alive].sort((a, b) => (b.stats?.pageviews || 0) - (a.stats?.pageviews || 0));
    for (const s of sorted) grid.appendChild(renderSiteCard(s));
    for (const s of empty) grid.appendChild(renderSiteCard(s, true));
  }

  function renderSiteCard(s, isEmpty) {
    const st = s.stats || { pageviews: 0, visitors: 0, visits: 0, comparison: {} };
    const delta = fmtPct(st.pageviews, st.comparison?.pageviews);
    const topPath = (s.paths && s.paths[0]?.x) || '—';
    const topRef = (s.referrers && s.referrers[0]?.x) || 'direct';

    const series = s.series?.pageviews || [];

    const card = el('div', { class: 'site-card' + (isEmpty ? ' empty' : '') }, [
      el('div', { class: 'site-head' }, [
        el('div', { class: 'site-name' }, [s.name]),
        el('div', { class: 'site-delta ' + delta.cls }, [delta.txt]),
      ]),
      el('div', { class: 'site-stats' }, [
        el('div', {}, [
          el('div', { class: 'site-stat-v' }, [fmtN(st.pageviews)]),
          el('div', { class: 'site-stat-l' }, ['PV']),
        ]),
        el('div', {}, [
          el('div', { class: 'site-stat-v' }, [fmtN(st.visitors)]),
          el('div', { class: 'site-stat-l' }, ['Visitors']),
        ]),
        el('div', {}, [
          el('div', { class: 'site-stat-v' }, [fmtN(st.visits)]),
          el('div', { class: 'site-stat-l' }, ['Sessions']),
        ]),
      ]),
      el('div', { class: 'site-spark' }),
      el('div', { class: 'site-bottom' }, [
        el('span', { title: 'top page' }, [topPath]),
        el('span', { class: 'chip', title: 'top referrer' }, [topRef]),
      ]),
    ]);
    card.querySelector('.site-spark').appendChild(sparkline(series, { w: 220, h: 28 }));
    return card;
  }

  /* ---------- render: source buckets ---------- */
  function renderSourceBuckets(buckets) {
    const host = $('#source-buckets');
    host.innerHTML = '';
    const entries = [
      ['ai', 'AI Assistants'],
      ['search', 'Search Engines'],
      ['social', 'Social'],
      ['direct', 'Direct / no referrer'],
      ['other', 'Other'],
    ];
    const total = entries.reduce((a, [k]) => a + (buckets[k] || 0), 0) || 1;
    for (const [k, label] of entries) {
      const v = buckets[k] || 0;
      const pct = Math.round((v / total) * 100);
      host.appendChild(renderBarRow(label, v, pct, 'color-' + k));
    }
  }

  /* ---------- render: top referrers ---------- */
  function renderReferrers(refs) {
    const host = $('#top-referrers');
    host.innerHTML = '';
    const max = refs.reduce((a, r) => Math.max(a, r.y), 0) || 1;
    for (const r of refs) {
      const pct = Math.round((r.y / max) * 100);
      const label = r.x || 'direct';
      const cls = classifyReferrer(label);
      host.appendChild(renderBarRow(label, r.y, pct, cls));
    }
    if (!refs.length) host.appendChild(el('div', { class: 'empty-text' }, ['no referrers']));
  }

  function classifyReferrer(host) {
    const h = host.toLowerCase();
    if (/chatgpt|perplexity|claude\.ai|gemini|copilot|poe/.test(h)) return 'color-ai';
    if (/google|bing|duckduckgo|brave|yahoo|yandex|ecosia/.test(h)) return 'color-search';
    if (/x\.com|twitter|facebook|instagram|linkedin|reddit|threads|tiktok|bsky/.test(h)) return 'color-social';
    return 'color-other';
  }

  function renderBarRow(label, value, pct, colorCls) {
    const wrap = el('div', { class: 'wrap' }, [
      el('div', { class: 'bar-track', style: 'width:' + pct + '%' }),
      el('div', { class: 'label-inner', title: label }, [label]),
    ]);
    return el('div', { class: 'bar-row ' + (colorCls || '') }, [wrap, el('div', { class: 'v' }, [fmtN(value)])]);
  }

  /* ---------- render: paths / events per site ---------- */
  function renderTopPaths(sites) {
    const host = $('#top-paths');
    host.innerHTML = '';
    const active = sites.filter((s) => s.paths && s.paths.length > 0).sort((a, b) => (b.stats?.pageviews || 0) - (a.stats?.pageviews || 0));
    if (!active.length) { host.appendChild(el('div', { class: 'empty-text' }, ['no path data'])); return; }
    for (const s of active.slice(0, 4)) {
      const total = s.paths.reduce((a, p) => a + p.y, 0) || 1;
      const group = el('div', { class: 'section-group' }, [
        el('div', { class: 'section-group-head' }, [
          el('span', { class: 'site' }, [s.name]),
          el('span', { class: 'total' }, [fmtN(total) + ' views']),
        ]),
      ]);
      const max = s.paths.reduce((a, p) => Math.max(a, p.y), 0) || 1;
      for (const p of s.paths.slice(0, 5)) {
        const pct = Math.round((p.y / max) * 100);
        group.appendChild(renderBarRow(p.x || '(blank)', p.y, pct));
      }
      host.appendChild(group);
    }
  }

  function renderTopEvents(sites) {
    const host = $('#top-events');
    host.innerHTML = '';
    const active = sites.filter((s) => s.events && s.events.length > 0);
    if (!active.length) { host.appendChild(el('div', { class: 'empty-text' }, ['no custom events in period'])); return; }
    for (const s of active) {
      const total = s.events.reduce((a, p) => a + p.y, 0) || 1;
      const group = el('div', { class: 'section-group' }, [
        el('div', { class: 'section-group-head' }, [
          el('span', { class: 'site' }, [s.name]),
          el('span', { class: 'total' }, [fmtN(total) + ' fires']),
        ]),
      ]);
      const max = s.events.reduce((a, p) => Math.max(a, p.y), 0) || 1;
      for (const p of s.events.slice(0, 6)) {
        const pct = Math.round((p.y / max) * 100);
        group.appendChild(renderBarRow(p.x, p.y, pct));
      }
      host.appendChild(group);
    }
  }

  /* ---------- boot ---------- */
  async function loadAll() {
    try {
      const [summary, insights] = await Promise.all([
        api('/api/admin/analytics/summary?period=' + state.period),
        api('/api/admin/analytics/insights?period=' + state.period),
      ]);
      state.summary = summary;
      state.insights = insights;

      renderKPIs(summary.totals, summary.sites.length);
      renderSites(summary.sites);
      renderSourceBuckets(insights.sourceBuckets);
      renderReferrers(insights.topReferrers);
      renderTopPaths(summary.sites);
      renderTopEvents(summary.sites);

      const d = new Date(summary.generatedAt);
      $('#last-update').textContent = 'updated ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      $('#generated').textContent = 'generated ' + d.toLocaleString();
    } catch (e) {
      console.error('[analytics]', e);
    }
  }

  function bind() {
    $('#login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      $('#login-err').classList.add('hidden');
      const pw = $('#password').value.trim();
      if (!pw) return;
      try {
        const ok = await tryLogin(pw);
        if (!ok) {
          $('#login-err').textContent = 'Invalid password.';
          $('#login-err').classList.remove('hidden');
          return;
        }
        showApp();
        await loadAll();
      } catch (e) {
        $('#login-err').textContent = e.message || 'Login failed';
        $('#login-err').classList.remove('hidden');
      }
    });

    $('#logout').addEventListener('click', () => {
      localStorage.removeItem(LS_TOKEN);
      state.token = null;
      showLogin();
      $('#password').value = '';
    });

    $('#refresh').addEventListener('click', loadAll);

    $$('#period-tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        $$('#period-tabs button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        state.period = b.getAttribute('data-p');
        loadAll();
      });
    });
  }

  function init() {
    bind();
    const saved = localStorage.getItem(LS_TOKEN);
    if (saved) {
      state.token = saved;
      // Probe quickly; if fails, show login
      fetch('/api/admin/analytics/summary?period=' + state.period, {
        headers: { Authorization: 'Bearer ' + saved },
      }).then((r) => {
        if (r.status === 401) {
          localStorage.removeItem(LS_TOKEN);
          state.token = null;
          showLogin();
          return;
        }
        showApp();
        loadAll();
      }).catch(() => showLogin());
    } else {
      showLogin();
    }
  }

  init();
})();
