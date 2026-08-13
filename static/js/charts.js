/* ══════════════════════════════════════════════════════════════════════
   charts.js — Rendu de tous les graphiques Chart.js et tableaux
   Dépend de : config.js, helpers.js
══════════════════════════════════════════════════════════════════════ */

const charts = {};   // registre local des instances Chart.js actives

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
    const recent = values.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, values.length);
    const older  = values.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, values.length);
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


//---------
function showEntityDrilldown(entityName, hostData) {
  // On trie les hosts par volume d'alertes
  const sortedHosts = Object.entries(hostData).sort((a, b) => b[1] - a[1]);
  
  let html = `<div style="padding:10px">
    <h4 style="margin-bottom:15px; color:var(--primary)">
      <i class="fa-solid fa-network-wired"></i> Hosts impactés pour : ${entityName}
    </h4>
    <table style="width:100%; border-collapse: collapse; font-size:13px;">
      <thead style="border-bottom: 1px solid #1c2a3e; color:var(--text-muted)">
        <tr><th align="left" style="padding:8px">Host</th><th align="right" style="padding:8px">Volume</th></tr>
      </thead>
      <tbody>`;

  sortedHosts.forEach(([host, count]) => {
    html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05)">
      <td style="padding:8px">${host}</td>
      <td align="right" style="padding:8px"><strong>${count}</strong></td>
    </tr>`;
  });

  html += `</tbody></table></div>`;

  // Ici, utilise ton système de modal (ex: Swal ou un modal Bootstrap)
  // Si tu as un modal "détail" déjà prêt :
  const container = document.getElementById('commonModalBody'); 
  if (container) {
    container.innerHTML = html;
    $('#commonModal').modal('show'); // Si tu utilises Bootstrap/jQuery
  }
}

// ── Donut — Classifications LogRhythm ─────────────────────────────────────────
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
      cutout: '75%',
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

function renderIntrusionChart(det) {
  const ctx = document.getElementById('chartIntrusionDonut');
  if (!ctx) return;

  if (window.myIntrusionChart) {
    window.myIntrusionChart.destroy();
  }

  window.myIntrusionChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      // On ajoute 'Configuration' et 'Autres' pour correspondre au dictionnaire Python
      labels: ['Malware', 'Brute Force', 'Web Attack', 'Config Modified'],
      datasets: [{
        data: [
          det.malware || 0, 
          det.brute_force || 0, 
          det.web_attack || 0,
          det.config_mod || 0, // Ajouté
          //det.other || 0       // Ajouté pour éviter le vide si non classé
        ],
        backgroundColor: [
          '#22d3ee', // Cyan (Malware)
          '#fbbf24', // Orange (Brute Force)
          '#f87171', // Rouge (Web Attack)
          '#3b82f6', // Bleu (Configuration)
          //'#94a3b8'  // Gris (Autres)
        ],
        borderWidth: 2,
        borderColor: '#1e293b', 
        hoverOffset: 10
      }]
    },
    options: {
      cutout: '75%', 
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            usePointStyle: true,
            padding: 15,
            font: { size: 10 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.raw || 0;
              return ` ${label} : ${value}`;
            }
          }
        }
      }
    }
  });
}

// ── Donut — Cases par priorité ────────────────────────────────────────────────
/*function renderCasesChart(data) {
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
}*/

// Variable globale ou accessible pour stocker les cases de la période en cours
let currentCasesList = []; 

function renderCasesChart(data) {
  // On sauvegarde la liste brute des cases reçue de l'API (si elle existe)
  currentCasesList = data.cases_list || []; 
  
  const by_prio = data.cases_by_priority || {};
  const labels  = Object.keys(by_prio).map(k => PRIORITY_LABELS[k] || `P${k}`);
  const values  = Object.values(by_prio);
  const colors  = Object.keys(by_prio).map(k => PRIORITY_COLORS[k] || COLORS.blue);
  const total   = data.total_cases || 0;
  
  setText('totalCasesBadge', `${fmtNum(total)} cases`);
  destroyChart('chartCases');

  const casesCanvas = document.getElementById('chartCases');
  const casesEmpty  = document.getElementById('chartCasesEmpty');
  const centerText  = document.getElementById('chartCasesCenterText'); 

  // ── CONFIGURATION DE L'AFFICHAGE DU GRAPHIQUE ──
  if (total === 0) {
    // Si la période est vide
    if (casesCanvas) casesCanvas.style.display = 'none';
    if (centerText)  centerText.style.display  = 'none';
    if (casesEmpty)  casesEmpty.style.display  = 'block';
  } else {
    // Si on a des données, on affiche le graphique et le texte au centre
    if (casesCanvas) casesCanvas.style.display = 'block';
    if (casesEmpty)  casesEmpty.style.display  = 'none';
    if (centerText) {
      centerText.style.display = 'block';
      document.getElementById('chartCenterRate').textContent = `${data.escalation_rate || 0}%`;
    }
  }

  // ── MISE À JOUR DES BADGES (S'EXÉCUTE TOUJOURS) ──
  
  // 1. Badge Rouge (Backlog) — Global, indépendant des dates
  if (data.backlog_cases !== undefined) {
      document.getElementById('backlogCasesBadge').textContent = `${data.backlog_cases} en attente (Backlog)`;
      document.getElementById('backlogCasesBadge').style.backgroundColor = data.backlog_cases > 0 ? '#ef4444' : '#06b6d4';
  } else {
      document.getElementById('backlogCasesBadge').textContent = '0 en attente';
  }

  // 2. Badge Vert (Traités) — Lié à la période
  if (data.resolved_cases !== undefined) {
      document.getElementById('resolvedCasesBadge').textContent = `${data.resolved_cases} traité(s)`;
  } else {
      document.getElementById('resolvedCasesBadge').textContent = '0 traité';
  }

  // 3. Bandeau de performance VP / FP sous le tableau — Lié à la période
  if (!data.resolved_cases || data.resolved_cases === 0) {
      // Si aucun dossier n'a été traité aujourd'hui, on met des tirets neutres
      document.getElementById('truePositiveRateValue').textContent = "--";
      document.getElementById('falsePositiveRateValue').textContent = "--";
  } else {
      document.getElementById('truePositiveRateValue').textContent = `${data.true_positive_rate || 0}%`;
      document.getElementById('falsePositiveRateValue').textContent = `${data.false_positive_rate || 0}%`;
  }

  // ── DESSIN DU GRAPHIQUE (UNIQUEMENT SI DONNÉES DISPONIBLES) ──
  if (total > 0) {
      charts.cases = new Chart(casesCanvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#0e1522', hoverOffset: 6 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          cutout: '70%', 
          onClick: () => {
              let url = '/cases/list';
              if (typeof customDateFrom !== 'undefined' && customDateFrom && customDateTo) {
                  url += `?date_from=${customDateFrom}&date_to=${customDateTo}`;
              } else if (typeof currentDays !== 'undefined' && currentDays) {
                  url += `?days=${currentDays}`;
              }
              window.open(url, '_blank');
          },
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } },
            tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} (${pct(ctx.raw, total)}%)` } }
          }
        }
      });
  }
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

// ── Fonctions réservées pour futures évolutions ───────────────────────────────
function renderAlertEvolutionChart(data) {
  const labels   = data.daily_labels || [];
  const bySev    = data.daily_by_severity || {};
  const datasets = [
    { label: 'Critical', data: bySev.Critical || [], borderColor: COLORS.red,    backgroundColor: 'rgba(232,64,64,0.08)',   borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
    { label: 'High',     data: bySev.High     || [], borderColor: COLORS.orange, backgroundColor: 'rgba(240,146,43,0.08)',  borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
    { label: 'Medium',   data: bySev.Medium   || [], borderColor: COLORS.yellow, backgroundColor: 'rgba(240,192,64,0.06)', borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
    { label: 'Low',      data: bySev.Low      || [], borderColor: COLORS.green,  backgroundColor: 'rgba(46,194,126,0.06)',  borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
  ];
  const crit = bySev.Critical || [];
  let trendText = '';
  if (crit.length >= 2) {
    const recent = crit.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, crit.length);
    const older  = crit.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, crit.length);
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
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 12, padding: 14, font: { size: 11 } } } },
      scales: {
        x: { grid: { color: '#1c2a3e' }, ticks: { maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } } },
        y: { grid: { color: '#1c2a3e' }, beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });
}

function renderTopMitreChart(data) {
  const rules   = data.top_rules || {};
  const labels  = Object.keys(rules).slice(0, 8);
  const values  = labels.map(k => rules[k]);
  const total   = values.reduce((a, b) => a + b, 0);
  const palette = [COLORS.red, COLORS.orange, COLORS.blue, COLORS.yellow, COLORS.cyan, COLORS.purple, COLORS.pink, COLORS.green];
  const colors  = labels.map((_, i) => palette[i % palette.length]);
  setText('mitreBadge', `${labels.length} règles`);
  destroyChart('chartMitre');
  charts.mitre = new Chart(document.getElementById('chartMitre'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#0e1522', hoverOffset: 6 }] },
    options: {
      cutout: '62%',
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: ctx => ` ${fmtNum(ctx.raw)} (${pct(ctx.raw, total)}%)`,
        title: ctx => ctx[0].label.length > 35 ? ctx[0].label.slice(0, 35) + '…' : ctx[0].label,
      }}},
    },
  });
  document.getElementById('mitreLegend').innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${colors[i]}"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(l)}">${escHtml(l)}</span>
      <span class="legend-count">${fmtNum(values[i])}</span>
    </div>`).join('');
}

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
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#0e1522', hoverOffset: 6 }] },
    options: {
      cutout: '60%',
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 10 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtNum(ctx.raw)} (${pct(ctx.raw, total)}%)` }} },
    },
  });
}

function renderAgentsEvolutionChart(data) {
  const labels   = data.daily_labels    || [];
  const byEntity = data.daily_by_entity || {};
  const entities = Object.keys(byEntity);
  const palette  = [COLORS.cyan, COLORS.blue, COLORS.orange, COLORS.green, COLORS.purple];
  const datasets = entities.map((entity, i) => ({
    label: entity, data: byEntity[entity],
    backgroundColor: palette[i % palette.length], borderWidth: 0, borderRadius: 2,
  }));
  destroyChart('chartAgentsEvol');
  charts.agentsEvol = new Chart(document.getElementById('chartAgentsEvol'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } },
      scales: {
        x: { stacked: true, grid: { color: '#1c2a3e' }, ticks: { maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } } },
        y: { stacked: true, grid: { color: '#1c2a3e' }, beginAtZero: true },
      },
    },
  });
}

//--------------
// graphe des hosts impactés
let topSourcesChart = null;

function renderTopSourcesChart(data) {
    const canvas = document.getElementById('chartTopSources'); // Ajouté
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (topSourcesChart) topSourcesChart.destroy();

    // Gestion du vide
    if (!data || !data.labels || data.labels.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.font = '14px sans-serif';
        ctx.fillText("Aucun impact détecté", canvas.width / 2, canvas.height / 2);
        return;
    }

    const colors = ['#ef4444', '#f87171', '#fb923c', '#fbbf24', '#facc15', '#a3e635', '#4ade80', '#34d399', '#2dd4bf', '#22d3ee'];
    topSourcesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [{
                label: 'Nombre d\'alertes',
                data: data.values,
                backgroundColor: colors,
                borderRadius: 5,
                barThickness: 18
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { right: 50 } },
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, display: false },
                y: { ticks: { color: '#f8fafc', font: { size: 11, weight: 'bold' } } }
            }
        },
        plugins: [{
            id: 'displayValues',
            afterDraw: (chart) => {
                const { ctx } = chart;
                ctx.save();
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.font = 'bold 12px sans-serif';
                ctx.fillStyle = '#ffffff';
                chart.getDatasetMeta(0).data.forEach((bar, index) => {
                    ctx.fillText(chart.data.datasets[0].data[index], bar.x + 8, bar.y);
                });
                ctx.restore();
            }
        }]
    });
}

//-------top 10 source attaque
let topSourcesListChart = null;

function renderTopSourcesListChart(data) {
    const canvas = document.getElementById('chartTopSourcesList'); // Ajouté
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (topSourcesListChart) topSourcesListChart.destroy();

    if (!data || !data.labels || data.labels.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#7d97b8';
        ctx.textAlign = 'center';
        ctx.font = '500 14px Outfit, sans-serif';
        ctx.fillText("Aucune source détectée", canvas.width / 2, canvas.height / 2);
        return;
    }

    const colors = ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe'];
    topSourcesListChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [{
                label: 'Alertes générées',
                data: data.values,
                backgroundColor: colors,
                borderRadius: 4,
                barThickness: 20
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { right: 60 } },
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false, beginAtZero: true },
                y: { ticks: { color: '#f8fafc', font: { weight: 'bold' } } }
            }
        },
        plugins: [{
            id: 'drawSourceValues',
            afterDraw: (chart) => {
                const { ctx } = chart;
                ctx.save();
                ctx.font = 'bold 12px sans-serif';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                chart.getDatasetMeta(0).data.forEach((bar, index) => {
                    ctx.fillText(chart.data.datasets[0].data[index], bar.x + 10, bar.y);
                });
                ctx.restore();
            }
        }]
    });
}

//graphe des top 10 method
let topVulnsChart = null; // Variable globale pour le nouveau graphe

function renderTopVulnsChart(data) {
    const canvas = document.getElementById('chartTopVulns');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (topVulnsChart) topVulnsChart.destroy();

    if (!data || !data.labels || data.labels.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.font = '14px sans-serif';
        ctx.fillText("Aucune méthode identifiée", canvas.width / 2, canvas.height / 2);
        return;
    }

    const colors = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#6366f1', '#818cf8', '#4f46e5', '#4338ca', '#3730a3', '#312e81', '#1e1b4b'];
    topVulnsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [{
                label: 'Occurrences',
                data: data.values,
                backgroundColor: colors,
                borderRadius: 5,
                barThickness: 18
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { right: 60 } },
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false, beginAtZero: true },
                y: { ticks: { color: '#f8fafc', font: { size: 10, weight: 'bold' } } }
            }
        },
        plugins: [{
            id: 'displayVulnValues',
            afterDraw: (chart) => {
                const { ctx } = chart;
                ctx.save();
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.font = 'bold 12px sans-serif';
                ctx.fillStyle = '#ffffff';
                chart.getDatasetMeta(0).data.forEach((bar, index) => {
                    ctx.fillText(chart.data.datasets[0].data[index], bar.x + 8, bar.y);
                });
                ctx.restore();
            }
        }]
    });
}


// Graphe des top 10 exploits (Compromissions)
let topExploitsChart = null; 

function renderTopExploitsChart(data) {
    const canvas = document.getElementById('chartTopExploits');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (topExploitsChart) topExploitsChart.destroy();

    if (!data || !data.labels || data.labels.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.font = '14px sans-serif';
        ctx.fillText("Aucune exploitation (CVE) détectée", canvas.width / 2, canvas.height / 2);
        return;
    }

    const exploitColors = ['#f59e0b', '#fbbf24', '#fcd34d', '#d97706', '#b45309', '#92400e', '#78350f', '#fef3c7', '#fde68a', '#fbbf24'];
    topExploitsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [{
                label: 'Confirmées',
                data: data.values,
                backgroundColor: exploitColors,
                borderRadius: 5,
                barThickness: 18
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { right: 60 } },
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false, beginAtZero: true },
                y: { ticks: { color: '#f8fafc', font: { size: 10, weight: 'bold' } } }
            }
        },
        plugins: [{
            id: 'displayExploitValues',
            afterDraw: (chart) => {
                const { ctx } = chart;
                ctx.save();
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.font = 'bold 12px sans-serif';
                ctx.fillStyle = '#ffffff';
                chart.getDatasetMeta(0).data.forEach((bar, index) => {
                    ctx.fillText(chart.data.datasets[0].data[index], bar.x + 8, bar.y);
                });
                ctx.restore();
            }
        }]
    });
}