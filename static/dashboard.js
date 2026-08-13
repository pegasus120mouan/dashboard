/* ══════════════════════════════════════════════════════════════════════
   SirDashboard — Logique dashboard SOC
   Chart.js 4.x | Flatpickr | Auto-refresh 5min
══════════════════════════════════════════════════════════════════════ */

// ── Configuration Chart.js globale ───────────────────────────────────────────
Chart.defaults.color          = '#6a8aaa';
Chart.defaults.borderColor    = '#1c2a3e';
Chart.defaults.font.family    = "'Segoe UI', system-ui, sans-serif";

const COLORS = {
  red:    '#e84040',  redA:    'rgba(232,64,64,0.7)',
  orange: '#f0922b',  orangeA: 'rgba(240,146,43,0.7)',
  green:  '#2ec27e',  greenA:  'rgba(46,194,126,0.7)',
  blue:   '#3b8beb',  blueA:   'rgba(59,139,235,0.7)',
  purple: '#9b59d0',  purpleA: 'rgba(155,89,208,0.7)',
  yellow: '#f0c040',  yellowA: 'rgba(240,192,64,0.7)',
  cyan:   '#00c8d4',  cyanA:   'rgba(0,200,212,0.7)',
  pink:   '#e05c8a',  pinkA:   'rgba(224,92,138,0.7)',
};

// Couleurs des 14 classifications LogRhythm (référentiel v7.23.0)
// Palette calée sur le Risk Rating : RR9=rouge, RR8=orange, RR6=jaune, RR5=rose, RR4=cyan, RR0=gris
const CLASSIFICATION_COLORS = {
  'Compromise':               COLORS.red,      // RR 9 — critique
  'Malware':                  COLORS.purple,   // RR 9 — critique
  'Attack':                   COLORS.orange,   // RR 8 — élevé
  'Denial of Service':        '#d04000',       // RR 8 — élevé
  'Suspicious':               COLORS.yellow,   // RR 6 — moyen-haut
  'Misuse':                   COLORS.pink,     // RR 5 — moyen
  'Reconnaissance':           COLORS.cyan,     // RR 4 — faible
  'Activity':                 COLORS.blue,     // RR 0 — informatif
  'Failed Attack':            '#3d5570',       // RR 0 — bloqué
  'Failed Denial of Service': '#4a4060',       // RR 0 — bloqué
  'Failed Malware':           '#4a3060',       // RR 0 — bloqué
  'Failed Suspicious':        '#3a4a50',       // RR 0 — bloqué
  'Failed Activity':          '#304050',       // RR 0 — bloqué
  'Other Security':           '#3a4a5a',       // RR 0 — non classifié
};

// Risk Rating par classification (pour les badges)
const CLASSIFICATION_RR = {
  'Compromise': 9, 'Malware': 9,
  'Attack': 8, 'Denial of Service': 8,
  'Suspicious': 6,
  'Misuse': 5,
  'Reconnaissance': 4,
  'Activity': 0, 'Failed Attack': 0, 'Failed Denial of Service': 0,
  'Failed Malware': 0, 'Failed Suspicious': 0, 'Failed Activity': 0,
  'Other Security': 0,
};

const STATUS_COLORS = {
  'New':                  COLORS.red,
  'Open':                 COLORS.orange,
  'Open: Working':        COLORS.yellow,
  'Open: Escalated':      '#d04000',
  'Closed: False Alarm':  '#3d5570',
  'Closed: Resolved':     COLORS.green,
  'Closed: Unresolved':   '#4a6080',
  'Closed: Reported':     COLORS.blue,
  'Closed: Monitor':      COLORS.cyan,
};

const PRIORITY_LABELS = { '1': 'Critical', '2': 'High', '3': 'Medium', '4': 'Low', '5': 'Info' };
const PRIORITY_COLORS = {
  '1': COLORS.red, '2': COLORS.orange,
  '3': COLORS.yellow, '4': COLORS.blue, '5': COLORS.green,
};

// ── État global ───────────────────────────────────────────────────────────────
let currentDays    = 30;
let customDateFrom = null;   // 'YYYY-MM-DD' — null si plage rapide active
let customDateTo   = null;
let fpFrom         = null;   // instances flatpickr
let fpTo           = null;
let autoRefreshId  = null;
const charts       = {};
let _criticalAlarms = [];    // cache pour le modal de détail

// Référentiel RR → texte (pour le modal)
const RR_META = {
  9: {
    level:    'Critique',
    meaning:  'Compromission confirmée ou malware actif',
    transfer: 'Forward All → Forward All',
    action:   'Intervention immédiate requise',
    desc:     'Isoler le système compromis, alerter le RSSI, déclencher la procédure de réponse à incident.',
    cls:      'detail-action-critical',
    icon:     'fa-fire',
  },
  8: {
    level:    'Élevé',
    meaning:  'Attaque ou DoS actif présumé réussi',
    transfer: 'Forward All → Forward All',
    action:   'Escalade prioritaire requise',
    desc:     'Analyser immédiatement les logs, bloquer la source si possible, escalader au responsable SOC.',
    cls:      'detail-action-high',
    icon:     'fa-triangle-exclamation',
  },
};

// ── Initialisation ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Boutons de période rapide
  document.querySelectorAll('.period-btn').forEach(btn => {
    if (parseInt(btn.dataset.days) === currentDays) btn.classList.add('active');
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => {
        b.classList.remove('active', 'dimmed');
      });
      btn.classList.add('active');
      currentDays = parseInt(btn.dataset.days);
      // Réinitialise plage custom si on clique sur un bouton rapide
      if (customDateFrom || customDateTo) {
        customDateFrom = null;
        customDateTo   = null;
        if (fpFrom) fpFrom.clear();
        if (fpTo)   fpTo.clear();
        document.getElementById('btnApply').disabled = true;
        document.getElementById('btnClearRange').style.display = 'none';
      }
      loadMetrics(currentDays, false);
    });
  });

  // Flatpickr — champ "Du"
  fpFrom = flatpickr('#dateFrom', {
    locale:     'fr',
    dateFormat: 'd/m/Y',
    maxDate:    'today',
    onChange(selectedDates) {
      customDateFrom = selectedDates.length ? isoDate(selectedDates[0]) : null;
      // Le "Au" doit être >= "Du"
      if (fpTo) fpTo.set('minDate', selectedDates.length ? selectedDates[0] : null);
      updateApplyBtn();
    }
  });

  // Flatpickr — champ "Au"
  fpTo = flatpickr('#dateTo', {
    locale:     'fr',
    dateFormat: 'd/m/Y',
    maxDate:    'today',
    onChange(selectedDates) {
      customDateTo = selectedDates.length ? isoDate(selectedDates[0]) : null;
      updateApplyBtn();
    }
  });

  loadMetrics(currentDays, false);
  startAutoRefresh();
  updateFooterTime();
  setInterval(updateFooterTime, 1000);

  // Fermeture du modal avec Échap
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAlarmDetail();
  });
});

// ── Plage personnalisée ───────────────────────────────────────────────────────
function applyCustomRange() {
  if (!customDateFrom || !customDateTo) return;
  // Atténue les boutons de période rapide
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.remove('active');
    b.classList.add('dimmed');
  });
  document.getElementById('btnClearRange').style.display = 'inline-flex';
  loadMetrics(null, false);
}

function clearCustomRange() {
  customDateFrom = null;
  customDateTo   = null;
  if (fpFrom) fpFrom.clear();
  if (fpTo)   fpTo.clear();
  document.getElementById('btnApply').disabled = true;
  document.getElementById('btnClearRange').style.display = 'none';
  // Restaure le bouton de période actif
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.remove('dimmed');
    if (parseInt(b.dataset.days) === currentDays) b.classList.add('active');
  });
  loadMetrics(currentDays, false);
}

function updateApplyBtn() {
  document.getElementById('btnApply').disabled = !(customDateFrom && customDateTo);
}

function isoDate(date) {
  // Retourne 'YYYY-MM-DD' à partir d'un objet Date
  return date.toISOString().slice(0, 10);
}

// ── Chargement des métriques ──────────────────────────────────────────────────
function loadMetrics(days, force = false) {
  showLoader(true);
  let url;
  if (customDateFrom && customDateTo) {
    url = `/api/metrics?date_from=${customDateFrom}&date_to=${customDateTo}&force=${force}`;
  } else {
    url = `/api/metrics?days=${days}&force=${force}`;
  }

  fetch(url)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => {
      renderAll(data);
      showLoader(false);
      document.getElementById('mainContent').style.display = 'flex';
      document.getElementById('mainContent').style.flexDirection = 'column';
    })
    .catch(err => {
      showLoader(false);
      showError(`Erreur chargement données : ${err.message}`);
    });
}

function refreshData() {
  const icon = document.getElementById('refreshIcon');
  icon.classList.add('fa-spin');
  loadMetrics(customDateFrom ? null : currentDays, true);
  setTimeout(() => icon.classList.remove('fa-spin'), 1500);
}

function startAutoRefresh() {
  if (autoRefreshId) clearInterval(autoRefreshId);
  autoRefreshId = setInterval(() => {
    loadMetrics(customDateFrom ? null : currentDays, true);
  }, 300000); // 5 min
}

// ── Rendu complet ─────────────────────────────────────────────────────────────
function renderAll(data) {
  renderKPIs(data);
  renderStatusChart(data);
  renderTrendChart(data);
  renderEntitiesChart(data);
  renderAttackTypesChart(data);
  renderIntrusionChart(det);
  renderCasesChart(data);
  renderCasesStatusTable(data);
  renderTopRulesTable(data);
  renderCriticalAlarmsTable(data);
  renderLastUpdated(data);
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────
function renderKPIs(data) {
  const total    = data.total_alarms    || 0;
  const critical = data.critical_alarms || 0;   // RR 9
  const high     = data.high_alarms     || 0;   // RR 8
  const backlog  = data.backlog         || 0;
  const fp       = data.false_positive_rate ?? 0;
  const tp       = data.true_positive_rate  ?? 0;
  const intrusion= data.intrusion_attempts  || 0;

  setText('kpiTotal',   fmtNum(total));

  // Affiche la plage active dans le sous-titre
  if (customDateFrom && customDateTo) {
    const df = customDateFrom.split('-').reverse().join('/');
    const dt = customDateTo.split('-').reverse().join('/');
    setText('kpiPeriod', `${df} → ${dt}`);
  } else {
    setText('kpiPeriod', `${currentDays} derniers jours`);
  }

  setText('kpiCritical',    fmtNum(critical));
  setText('kpiHigh',        fmtNum(high));
  setText('kpiHighPct',     total ? `${pct(high, total)}% du total` : 'RR 8 — Attack / DoS');
  setText('kpiBacklog',     fmtNum(backlog));
  setText('kpiBacklogPct',  total ? `${pct(backlog, total)}% du total` : '—');
  setText('kpiFP', `${fp}%`);
  setText('kpiTP', `${tp}%`);
  setText('kpiIntrusion', fmtNum(intrusion));

  // Couleur dynamique FP/TP — null-safe (cartes masquées si commentées dans HTML)
  const fpCard = document.getElementById('kpiFpCard');
  if (fpCard) {
    fpCard.className = 'kpi-card ' + (fp > 20 ? 'kpi-red' : fp > 10 ? 'kpi-orange' : 'kpi-green');
  }
  const tpCard = document.getElementById('kpiTpCard');
  if (tpCard) {
    tpCard.className = 'kpi-card ' + (tp > 30 ? 'kpi-green' : tp > 10 ? 'kpi-orange' : 'kpi-red');
  }

  // Bandeau critique si présence d'alertes RR9 ou RR8 non traitées
  const banner = document.getElementById('criticalBanner');
  if (critical > 0 || high > 0) {
    const parts = [];
    if (critical > 0) parts.push(`${fmtNum(critical)} critique(s) RR9`);
    if (high > 0)     parts.push(`${fmtNum(high)} élevée(s) RR8`);
    /*document.getElementById('criticalBannerText').textContent =
      `ATTENTION : ${parts.join(' • ')} non traitée(s) en backlog`;
    banner.style.display = 'flex';*/
  } else {
    banner.style.display = 'none';
  }

  setText('criticalCountBadge', critical > 0 ? `${fmtNum(critical)} crit.` : '');
  setText('highCountBadge',     high > 0     ? `${fmtNum(high)} élev.`  : '');
}

// ── Donut — Distribution par statut ──────────────────────────────────────────
function renderStatusChart(data) {
  const by_status = data.by_status || {};
  const labels    = Object.keys(by_status);
  const values    = Object.values(by_status);
  const colors    = labels.map(l => STATUS_COLORS[l] || '#3d5570');
  const total     = values.reduce((a, b) => a + b, 0);

  destroyChart('chartStatus');
  charts.status = new Chart(document.getElementById('chartStatus'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#0e1522', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtNum(ctx.raw)} (${pct(ctx.raw, total)}%)` } }
      }
    }
  });
  document.getElementById('statusLegend').innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${colors[i]}"></span>
      <span>${l}</span>
      <span class="legend-count">${fmtNum(values[i])}</span>
    </div>`).join('');
}

// ── Line — Évolution quotidienne ──────────────────────────────────────────────
function renderTrendChart(data) {
  const labels = data.daily_labels || [];
  const values = data.daily_counts || [];
  let trendText = '';
  if (values.length >= 2) {
    const recent = values.slice(-3).reduce((a,b) => a+b, 0) / Math.min(3, values.length);
    const older  = values.slice(0, 3).reduce((a,b) => a+b, 0) / Math.min(3, values.length);
    if (recent > older * 1.2)      trendText = '↑ En hausse';
    else if (recent < older * 0.8) trendText = '↓ En baisse';
    else                           trendText = '→ Stable';
  }
  setText('trendBadge', trendText);
  destroyChart('chartTrend');
  charts.trend = new Chart(document.getElementById('chartTrend'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Alertes / jour', data: values, borderColor: COLORS.blue, backgroundColor: 'rgba(59,139,235,0.08)', borderWidth: 2, pointRadius: 3, pointBackgroundColor: COLORS.blue, tension: 0.3, fill: true }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#1c2a3e' }, ticks: { maxTicksLimit: 10, maxRotation: 0 } },
        y: { grid: { color: '#1c2a3e' }, beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

// ── Bar horizontal — Top 10 entités ──────────────────────────────────────────
function renderEntitiesChart(data) {
  const top    = data.top_entities || {};
  const labels = Object.keys(top).reverse();
  const values = Object.values(top).reverse();
  const maxVal = Math.max(...values, 1);
  const colors = values.map(v => {
    const r = v / maxVal;
    return r > 0.7 ? COLORS.redA : r > 0.4 ? COLORS.orangeA : COLORS.blueA;
  });
  destroyChart('chartEntities');
  charts.entities = new Chart(document.getElementById('chartEntities'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Alertes', data: values, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#1c2a3e' }, beginAtZero: true },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

// ── Donut — Classifications LogRhythm ────────────────────────────────────────
function renderAttackTypesChart(data) {
  const types  = data.classifications || {};
  const labels = Object.keys(types);
  const values = Object.values(types);
  const colors = labels.map(l => CLASSIFICATION_COLORS[l] || '#3d5570');
  const total  = values.reduce((a, b) => a + b, 0);
  destroyChart('chartAttackTypes');
  charts.attackTypes = new Chart(document.getElementById('chartAttackTypes'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#0e1522', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => { const rr = CLASSIFICATION_RR[ctx.label] ?? 0; return ` ${ctx.label} (RR:${rr}): ${fmtNum(ctx.raw)} (${pct(ctx.raw, total)}%)`; } } }
      }
    }
  });
  document.getElementById('attackLegend').innerHTML = labels.map((l, i) => {
    const rr = CLASSIFICATION_RR[l] ?? 0;
    return `<div class="legend-item">
      <span class="legend-dot" style="background:${colors[i]}"></span>
      <span>${l}</span>
      <span class="legend-count" style="color:var(--text-muted);font-size:10px">RR:${rr}</span>
      <span class="legend-count">${fmtNum(values[i])}</span>
    </div>`;
  }).join('');
}

// ── Donut — Cases par priorité ────────────────────────────────────────────────
function renderCasesChart(data) {
  const by_prio = data.cases_by_priority || {};
  const labels  = Object.keys(by_prio).map(k => PRIORITY_LABELS[k] || `P${k}`);
  const values  = Object.values(by_prio);
  const colors  = Object.keys(by_prio).map(k => PRIORITY_COLORS[k] || COLORS.blue);
  const total   = data.total_cases || 0;
  setText('totalCasesBadge', `${fmtNum(total)} cases`);
  destroyChart('chartCases');
  const casesCanvas = document.getElementById('chartCases');
  const casesEmpty  = document.getElementById('chartCasesEmpty');
  if (total === 0) {
    if (casesCanvas) casesCanvas.style.display = 'none';
    if (casesEmpty)  casesEmpty.style.display  = 'block';
    return;
  }
  if (casesCanvas) casesCanvas.style.display = 'block';
  if (casesEmpty)  casesEmpty.style.display  = 'none';
  charts.cases = new Chart(casesCanvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#0e1522', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} (${pct(ctx.raw, total)}%)` } }
      }
    }
  });
}

// ── Table — Statuts des cases ─────────────────────────────────────────────────
function renderCasesStatusTable(data) {
  const by_status = data.cases_by_status || {};
  const total     = data.total_cases || 0;
  const entries   = Object.entries(by_status).sort((a, b) => b[1] - a[1]);
  document.getElementById('casesStatusBody').innerHTML = entries.map(([status, count]) =>
    `<tr><td>${statusBadge(status)}</td><td><b>${fmtNum(count)}</b></td><td>${progressBar(pct(count, total))}</td></tr>`
  ).join('') || '<tr><td colspan="3" style="color:var(--text-muted);text-align:center">Aucun case</td></tr>';
}

// ── Table — Top 10 règles ─────────────────────────────────────────────────────
function renderTopRulesTable(data) {
  const top_rules = data.top_rules || {};
  const total     = data.total_alarms || 0;
  document.getElementById('topRulesBody').innerHTML = Object.entries(top_rules).map(([rule, count], i) => {
    const atype = classifyAttackFront(rule);
    return `<tr>
      <td style="color:var(--text-muted);font-weight:600">${i + 1}</td>
      <td style="max-width:400px;word-break:break-word">${escHtml(rule)}</td>
      <td>${classificationBadge(atype, null)}</td>
      <td><b>${fmtNum(count)}</b></td>
      <td>${progressBar(pct(count, total))}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="color:var(--text-muted);text-align:center">Aucune donnée</td></tr>';
}

// ── Multi-line — Alert level evolution (réservé future use) ──────────────────
function renderAlertEvolutionChart(data) {
  const labels   = data.daily_labels || [];
  const bySev    = data.daily_by_severity || {};
  const datasets = [
    { label: 'Critical', data: bySev.Critical || [], borderColor: COLORS.red,    backgroundColor: 'rgba(232,64,64,0.08)',   borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
    { label: 'High',     data: bySev.High     || [], borderColor: COLORS.orange, backgroundColor: 'rgba(240,146,43,0.08)',  borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
    { label: 'Medium',   data: bySev.Medium   || [], borderColor: COLORS.yellow, backgroundColor: 'rgba(240,192,64,0.06)', borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
    { label: 'Low',      data: bySev.Low      || [], borderColor: COLORS.green,  backgroundColor: 'rgba(46,194,126,0.06)',  borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
  ];

  // Tendance sur la ligne Critical
  const crit = bySev.Critical || [];
  let trendText = '';
  if (crit.length >= 2) {
    const recent = crit.slice(-3).reduce((a,b) => a+b, 0) / Math.min(3, crit.length);
    const older  = crit.slice(0, 3).reduce((a,b) => a+b, 0) / Math.min(3, crit.length);
    if (recent > older * 1.2)      trendText = '↑ En hausse';
    else if (recent < older * 0.8) trendText = '↓ En baisse';
    else                           trendText = '→ Stable';
  }
  setText('trendBadge', trendText);

  destroyChart('chartTrend');
  charts.trend = new Chart(document.getElementById('chartTrend'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { boxWidth: 12, padding: 14, font: { size: 11 } },
        },
      },
      scales: {
        x: { grid: { color: '#1c2a3e' }, ticks: { maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } } },
        y: { grid: { color: '#1c2a3e' }, beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });
}

// ── Donut — Top MITRE ATT&CKS (top règles) ───────────────────────────────────
function renderTopMitreChart(data) {
  const rules  = data.top_rules || {};
  const labels = Object.keys(rules).slice(0, 8);
  const values = labels.map(k => rules[k]);
  const total  = values.reduce((a, b) => a + b, 0);
  const palette = [COLORS.red, COLORS.orange, COLORS.blue, COLORS.yellow, COLORS.cyan, COLORS.purple, COLORS.pink, COLORS.green];
  const colors = labels.map((_, i) => palette[i % palette.length]);

  setText('mitreBadge', `${labels.length} règles`);

  destroyChart('chartMitre');
  charts.mitre = new Chart(document.getElementById('chartMitre'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#0e1522', hoverOffset: 6 }],
    },
    options: {
      cutout: '62%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: ctx => ` ${fmtNum(ctx.raw)} (${pct(ctx.raw, total)}%)`,
          title: ctx => ctx[0].label.length > 35 ? ctx[0].label.slice(0, 35) + '…' : ctx[0].label,
        }},
      },
    },
  });

  const legend = document.getElementById('mitreLegend');
  legend.innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${colors[i]}"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(l)}">${escHtml(l)}</span>
      <span class="legend-count">${fmtNum(values[i])}</span>
    </div>`).join('');
}

// ── Donut — Top 5 agents (entités) ───────────────────────────────────────────
function renderTopAgentsChart(data) {
  const top    = data.top_entities || {};
  const labels = Object.keys(top);
  const values = Object.values(top);
  const total  = values.reduce((a, b) => a + b, 0);
  const palette = [COLORS.cyan, COLORS.blue, COLORS.orange, COLORS.green, COLORS.purple];
  const colors = labels.map((_, i) => palette[i % palette.length]);

  destroyChart('chartAgents');
  charts.agents = new Chart(document.getElementById('chartAgents'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#0e1522', hoverOffset: 6 }],
    },
    options: {
      cutout: '60%',
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 10, padding: 10, font: { size: 10 } },
        },
        tooltip: { callbacks: {
          label: ctx => ` ${ctx.label}: ${fmtNum(ctx.raw)} (${pct(ctx.raw, total)}%)`,
        }},
      },
    },
  });
}

// ── Stacked bar — Alerts evolution Top 5 agents ──────────────────────────────
function renderAgentsEvolutionChart(data) {
  const labels    = data.daily_labels    || [];
  const byEntity  = data.daily_by_entity || {};
  const entities  = Object.keys(byEntity);
  const palette   = [COLORS.cyan, COLORS.blue, COLORS.orange, COLORS.green, COLORS.purple];

  const datasets = entities.map((entity, i) => ({
    label:           entity,
    data:            byEntity[entity],
    backgroundColor: palette[i % palette.length],
    borderWidth:     0,
    borderRadius:    2,
  }));

  destroyChart('chartAgentsEvol');
  charts.agentsEvol = new Chart(document.getElementById('chartAgentsEvol'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { boxWidth: 10, padding: 12, font: { size: 11 } },
        },
      },
      scales: {
        x: { stacked: true, grid: { color: '#1c2a3e' }, ticks: { maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } } },
        y: { stacked: true, grid: { color: '#1c2a3e' }, beginAtZero: true },
      },
    },
  });
}

// ── Table — Alertes critiques ─────────────────────────────────────────────────
function renderCriticalAlarmsTable(data) {
  const list  = data.critical_list || [];
  const tbody = document.getElementById('criticalAlarmsBody');

  // Trie : critiques (RR9) en premier, puis élevées (RR8)
  _criticalAlarms = [...list].sort((a, b) => (b.riskRating || 0) - (a.riskRating || 0));

  tbody.innerHTML = _criticalAlarms.map((alarm, idx) => {
    const date  = alarm.dateInserted ? alarm.dateInserted.replace('T', ' ').slice(0, 19) : '—';
    const badge = statusBadge(alarm.alarmStatus);
    const sevBadge = alarm.severity === 'critical'
      ? `<span class="badge badge-rr9"><i class="fa-solid fa-circle-exclamation"></i> Critique RR9</span>`
      : `<span class="badge badge-rr8"><i class="fa-solid fa-triangle-exclamation"></i> Élevée RR8</span>`;
    return `<tr class="alarm-row-clickable" onclick="showAlarmDetail(${idx})" title="Cliquer pour voir les détails">
      <td style="color:var(--text-muted);font-size:12px">#${alarm.alarmId}</td>
      <td style="max-width:300px;word-break:break-word">${escHtml(alarm.alarmRuleName)}</td>
      <td>${escHtml(alarm.entityName)}</td>
      <td>${classificationBadge(alarm.classification, alarm.riskRating)}</td>
      <td>${sevBadge}</td>
      <td>${badge}</td>
      <td style="color:var(--text-muted);font-size:12px;white-space:nowrap">${date}</td>
      <td>${hostImpacted(alarm.hostImpacted)}</td>
      <td>${sourceHosts(alarm.sourceHosts)}</td>
      <td>${sourceIps(alarm.sourceIps)}
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="color:var(--green);text-align:center;padding:20px"><i class="fa-solid fa-check-circle"></i> Aucune alerte critique ou élevée non traitée</td></tr>';
}

// ── Métadonnées ───────────────────────────────────────────────────────────────
function renderLastUpdated(data) {
  if (data.last_updated) {
    const d = new Date(data.last_updated);
    const str = d.toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    setText('lastUpdated', `MAJ : ${str}`);
  }
}

// ── Helpers UI ────────────────────────────────────────────────────────────────
function showLoader(show) {
  document.getElementById('loader').style.display = show ? 'flex' : 'none';
}

function showError(msg) {
  document.getElementById('criticalBanner').style.display = 'flex';
  document.getElementById('criticalBannerText').textContent = msg;
  document.getElementById('mainContent').style.display = 'flex';
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function destroyChart(canvasId) {
  const existing = Chart.getChart(canvasId);
  if (existing) existing.destroy();
}

function updateFooterTime() {
  const el = document.getElementById('footerTime');
  if (el) el.textContent = new Date().toLocaleString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

// ── Helpers data ──────────────────────────────────────────────────────────────
function fmtNum(n) { return (n || 0).toLocaleString('fr-FR'); }
function pct(v, t) { return t ? Math.round(v / t * 100) : 0; }
function escHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function statusBadge(status) {
  const s = (status || '').toLowerCase();
  let cls = 'badge-status-other';
  if (s === 'new')                          cls = 'badge-status-new';
  else if (s.startsWith('open'))            cls = 'badge-status-open';
  else if (s.startsWith('closed'))          cls = 'badge-status-closed';
  return `<span class="badge ${cls}">${escHtml(status)}</span>`;
}

function progressBar(p) {
  return `<div class="progress-bar">
    <div class="progress-track"><div class="progress-fill" style="width:${p}%"></div></div>
    <span class="progress-label">${p}%</span>
  </div>`;
}

// ── Modal — Détail alarme ─────────────────────────────────────────────────────
function showAlarmDetail(idx) {
  const alarm = _criticalAlarms[idx];
  if (!alarm) return;

  const rr   = alarm.riskRating || 0;
  const meta = RR_META[rr] || {};
  const date = alarm.dateInserted ? alarm.dateInserted.replace('T', ' ').slice(0, 19) : '—';

  // En-tête
  document.getElementById('detailSevBadge').innerHTML = classificationBadge(alarm.classification, rr);
  document.getElementById('detailRuleName').textContent = alarm.alarmRuleName || '—';

  // Méta-données
  document.getElementById('detailId').textContent     = `#${alarm.alarmId}`;
  document.getElementById('detailDate').textContent   = date;
  document.getElementById('detailClassif').innerHTML  = classificationBadge(alarm.classification, rr);
  document.getElementById('detailRR').textContent     = `${rr} / 9`;
  document.getElementById('detailEntity').textContent = alarm.entityName || '—';
  document.getElementById('detailHost').textContent   = alarm.hostImpacted || '—';
  document.getElementById('detailStatus').innerHTML   = statusBadge(alarm.alarmStatus);
  document.getElementById('detailSeverity').innerHTML = alarm.severity === 'critical'
    ? `<span class="badge badge-rr9"><i class="fa-solid fa-circle-exclamation"></i> Critique</span>`
    : `<span class="badge badge-rr8"><i class="fa-solid fa-triangle-exclamation"></i> Élevée</span>`;

  //document.getElementById('detaildetip').textContent = alarm.destIps;  
  // Bloc RR info
  document.getElementById('detailRRLevel').textContent    = meta.level    || '—';
  document.getElementById('detailRRMeaning').textContent  = meta.meaning  || '—';
  document.getElementById('detailRRTransfer').textContent = meta.transfer || '—';

  // Bloc action
  const actionEl = document.getElementById('detailAction');
  actionEl.className = `detail-action ${meta.cls || ''}`;
  document.getElementById('detailActionIcon').className = `fa-solid ${meta.icon || 'fa-bolt'}`;
  document.getElementById('detailActionTitle').textContent = meta.action || '';
  document.getElementById('detailActionDesc').textContent  = meta.desc   || '';

  // Réinitialise la section drilldown en état de chargement
  document.getElementById('drilldownLoading').style.display = 'flex';
  document.getElementById('drilldownData').style.display    = 'none';
  document.getElementById('drilldownError').style.display   = 'none';

  // Affiche le modal immédiatement (avant que le drilldown soit chargé)
  document.getElementById('alarmDetailOverlay').classList.add('active');

  // Charge le drilldown de façon asynchrone (lazy)
  if (alarm.alarmId) {
    fetch(`/api/drilldown/${alarm.alarmId}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(dd => {
        // Si le modal a été refermé entre temps, on n'affiche rien
        if (!document.getElementById('alarmDetailOverlay').classList.contains('active')) return;

        const hasData = (dd.eventCount > 0) ||
          (dd.sourceHosts && dd.sourceHosts.length) ||
          (dd.destHosts   && dd.destHosts.length)   ||
          (dd.sourceIps   && dd.sourceIps.length)   ||
          (dd.destIps     && dd.destIps.length)      ||
          (dd.users       && dd.users.length);

        if (!hasData) {
          document.getElementById('drilldownLoading').style.display = 'none';
          document.getElementById('drilldownError').style.display   = 'flex';
          return;
        }

        // Remplit les chips
        renderDrilldownChips('ddSourceHosts', dd.sourceHosts, 'chip-host');
        renderDrilldownChips('ddDestHosts',   dd.destHosts,   'chip-host');
        renderDrilldownChips('ddSourceIps',   dd.sourceIps,   'chip-ip');
        renderDrilldownChips('ddDestIps',     dd.destIps,     'chip-ip');
        renderDrilldownChips('ddUsers',       dd.users,       'chip-user');

        // Met à jour le host principal si on avait "—" et que le drilldown a des données
        if (!alarm.hostImpacted && dd.destHosts && dd.destHosts.length) {
          document.getElementById('detailHost').textContent = dd.destHosts[0];
        }

        const eventEl = document.getElementById('ddEventCount');
        eventEl.textContent = dd.eventCount > 0 ? fmtNum(dd.eventCount) : '—';

        document.getElementById('drilldownLoading').style.display = 'none';
        document.getElementById('drilldownData').style.display    = 'grid';
      })
      .catch(() => {
        if (!document.getElementById('alarmDetailOverlay').classList.contains('active')) return;
        document.getElementById('drilldownLoading').style.display = 'none';
        document.getElementById('drilldownError').style.display   = 'flex';
      });
  } else {
    document.getElementById('drilldownLoading').style.display = 'none';
    document.getElementById('drilldownError').style.display   = 'flex';
  }
}

function renderDrilldownChips(elementId, items, chipClass) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = `<span style="color:var(--text-muted);font-size:12px">—</span>`;
    return;
  }
  el.innerHTML = items.map(v =>
    `<span class="drilldown-chip ${chipClass}">${escHtml(v)}</span>`
  ).join('');
}

function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function closeAlarmDetail() {
  document.getElementById('alarmDetailOverlay').classList.remove('active');
}

// Classification côté front — miroir du référentiel LogRhythm v7.23.0 (14 catégories)
function classifyAttackFront(ruleName) {
  const rl = (ruleName || '').toLowerCase();
  const patterns = {
    'Compromise':     ['compromise', 'privilege escalat', 'unauthorized access', 'takeover', 'sah:', 'apt:'],
    'Attack':         ['buffer overflow', 'sql injection', 'session hijack', 'exploit', 'brute force',
                       'password spray', 'auth fail', 'logon fail', 'injection', 'rce', 'cve-', 'shellcode'],
    'Denial of Service': ['denial of service', 'ddos', 'synflood', 'ping of death', 'win nuke',
                          'teardrop', 'resource starvation', 'spam flood'],
    'Malware':        ['malware', 'ransomware', 'trojan', 'backdoor', 'worm', 'virus', 'spyware', 'rootkit'],
    'Suspicious':     ['suspicious', 'suspect', 'anomal', 'default account', 'multiple fail'],
    'Reconnaissance': ['scan', 'recon', 'probe', 'enumeration', 'discovery', 'sweep', 'nmap', 'port scan', 'web crawl'],
    'Misuse':         ['webmail', 'p2p', 'peer-to-peer', 'pornograph', 'policy violation', 'misuse'],
    'Failed Attack':  ['failed attack', 'blocked attack', 'dropped attack'],
    'Failed Denial of Service': ['failed dos', 'blocked dos', 'prevented dos', 'prevented ddos'],
    'Failed Malware': ['failed malware', 'blocked malware', 'blocked trojan', 'blocked worm'],
    'Failed Suspicious': ['failed suspicious', 'blocked suspicious'],
    'Failed Activity':   ['failed activity', 'drop p2p', 'ftp refused'],
  };
  for (const [type, keywords] of Object.entries(patterns)) {
    if (keywords.some(kw => rl.includes(kw))) return type;
  }
  return 'Other Security';
}

// Badge de classification avec couleur selon Risk Rating
function classificationBadge(classification, rr) {
  const c = classification || 'Other Security';
  const r = rr ?? CLASSIFICATION_RR[c] ?? 0;
  let cls;
  if (r >= 9)      cls = 'badge-rr9';
  else if (r >= 8) cls = 'badge-rr8';
  else if (r >= 6) cls = 'badge-rr6';
  else if (r >= 5) cls = 'badge-rr5';
  else if (r >= 4) cls = 'badge-rr4';
  else             cls = 'badge-rr0';
  return `<span class="badge ${cls}">${escHtml(c)}<sup style="margin-left:3px;opacity:.75">RR${r}</sup></span>`;
}

//-------
function renderTopHostsChart(data) {
    const ctx = document.getElementById('topSourcesChart').getContext('2d');
    
    if (window.hostsChart) window.hostsChart.destroy();

    window.hostsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [{
                label: 'Nombre d\'alertes',
                data: data.values,
                backgroundColor: '#6366f1', // Un bleu-indigo plus moderne
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y', // Toujours horizontal pour lire les noms de serveurs
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { 
                    beginAtZero: true,
                    ticks: { color: '#94a3b8' } 
                },
                y: { 
                    ticks: { 
                        color: '#f1f5f9',
                        font: { size: 10 } // On réduit un peu la police si les noms sont longs
                    } 
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.raw} alertes sur ce host`
                    }
                }
            }
        }
    });
}

//-------------
// Variable globale isolée pour ne pas interférer avec tes autres graphiques
let entityListChartInstance = null;

function renderEntityListGraph(data) {
    console.log("Tentative de dessin du graphique avec :", data);
    const canvas = document.getElementById('canvasEntityList');
    
    const ctx = document.getElementById('canvasEntityList').getContext('2d');

    // Si le graphique existe déjà, on le détruit proprement avant de le recréer
    if (entityListChartInstance) {
        entityListChartInstance.destroy();
    }

    entityListChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels, // Les noms des entités
            datasets: [{
                label: 'Nombre total d\'alertes',
                data: data.values, // Les chiffres
                backgroundColor: '#6366f1', // Indigo pour différencier des autres
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal pour la lisibilité
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { beginAtZero: true },
                y: { ticks: { font: { size: 11 }, color: '#f8fafc' } }
            }
        }
    });
}