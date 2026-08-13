/* ══════════════════════════════════════════════════════════════════════
   main.js — Dashboard : rendu des données, KPI clics
   Dépend de : config.js, helpers.js, period.js, charts.js, modal.js
══════════════════════════════════════════════════════════════════════ */

function startTimer(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return null;
    
    el.style.display = 'inline-block';
    el.innerText = '0s';
    let seconds = 0;
    
    return setInterval(() => {
        seconds++;
        el.innerText = seconds + 's';
    }, 1000);
}

function stopTimer(elementId, intervalId) {
    clearInterval(intervalId);
    const el = document.getElementById(elementId);
    if (el) {
        // Optionnel : On peut laisser le temps final ou masquer après 3s
        setTimeout(() => { el.style.display = 'none'; }, 3000);
    }
}

let _criticalAlarms = [];   // cache pour le modal de détail (utilisé par modal.js)

function _queryParams(days, dateFrom, dateTo, force = false) {
  let params;
  if (dateFrom && dateTo) {
    params = `date_from=${dateFrom}&date_to=${dateTo}`;
  } else {
    params = `days=${days || currentDays || 30}`;
  }
  if (force) params += "&force=true";
  return params;
}

function setForensicLoading(on) {
  ["loading-impacted", "loading-sources", "loading-exploits"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? "flex" : "none";
  });
}

function renderForensicCharts(raw) {
  const stats = {
    sources: formatForChart(countOccurrences(raw, "source"), 10),
    impacted: formatForChart(countOccurrences(raw, "impacted"), 10),
    exploits: formatForChart(countOccurrences(raw.filter((d) => d.cve && d.cve !== ""), "cve"), 10),
    typo: formatForChart(countOccurrences(raw, "type"), 10),
  };
  renderTopSourcesListChart(stats.sources);
  renderTopSourcesChart(stats.impacted);
  renderTopVulnsChart(stats.typo);
  renderTopExploitsChart(stats.exploits);
}

// ── Callback requis par period.js ─────────────────────────────────────────────
function _loadPageData(days, dateFrom, dateTo, force = false) {
  showLoader(true);
  spinRefresh(2000);
  setForensicLoading(true);

  const params = _queryParams(days, dateFrom, dateTo, force);
  const timers = {
    s: startTimer("timer-sources"),
    i: startTimer("timer-impacted"),
    v: startTimer("timer-vulns"),
    e: startTimer("timer-exploits"),
  };

  fetch(`/api/metrics?${params}`)
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((data) => {
      const mainContent = document.getElementById("mainContent");
      if (mainContent) mainContent.style.display = "flex";
      renderAll(data);
      showLoader(false);
      return fetch(`/api/stats/full-forensic?${params}`);
    })
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((fullData) => {
      renderForensicCharts(fullData.forensic_details || []);
    })
    .catch((err) => {
      console.error("Chargement dashboard :", err);
      const mainContent = document.getElementById("mainContent");
      if (mainContent) mainContent.style.display = "flex";
      showLoader(false);
    })
    .finally(() => {
      stopTimer("timer-sources", timers.s);
      stopTimer("timer-impacted", timers.i);
      stopTimer("timer-vulns", timers.v);
      stopTimer("timer-exploits", timers.e);
      setForensicLoading(false);
    });
}

function refreshData() {
  _loadPageData(
    customDateFrom ? null : currentDays,
    customDateFrom,
    customDateTo,
    true
  );
}

// ── KPI → ouvre la page Events filtrée dans un nouvel onglet ─────────────────
function openAlarmsPage(severity) {
  const params = new URLSearchParams();
  params.set('severity', severity);
  if (customDateFrom && customDateTo) {
    params.set('date_from', customDateFrom);
    params.set('date_to',   customDateTo);
  } else {
    params.set('days', currentDays);
  }
  window.open(`/events?${params}`, '_blank');
}

// Brancher les clics KPI au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.kpi-clickable[data-severity]').forEach(card => {
    card.addEventListener('click', () => openAlarmsPage(card.dataset.severity));
  });
});

// ── Rendu complet ─────────────────────────────────────────────────────────────
// On ajoute un deuxième argument "forensic" (optionnel pour ne pas casser si on appelle renderAll ailleurs)
function renderAll(data, forensic = null) {
  // 1. BLOC CLASSIQUE (Utilise les données de base_stats)
  renderKPIs(data);
  renderStatusChart(data);
  renderTrendChart(data);
  //renderEntitiesChart(data);
  renderAttackTypesChart(data);
  renderCasesChart(data);
  renderCasesStatusTable(data);
  renderTopRulesTable(data);
  renderCriticalAlarmsTable(data);
  renderLastUpdated(data);

  // 2. BLOC FORENSIC (Utilise les données calculées localement)
  // On vérifie si 'forensic' existe avant de lancer les rendus
 // if (forensic) {
   //   renderTopSourcesChart(forensic.impacted);     // Top Impacted (selon ton ancienne logique)
   //   renderTopSourcesListChart(forensic.sources);  // Top Sources
   //   renderTopVulnsChart(forensic.sources);        // À ajuster si tu as une stat spécifique
    //  renderTopExploitsChart(forensic.exploits);    // Le nouveau graphe de vulnérabilités
  //}
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────
function renderKPIs(data) {
  const total    = data.total_alarms       || 0;
  const critical = data.severity_critical  || 0;
  const high     = data.severity_high      || 0;
  const medium   = data.severity_medium    || 0;
  const low      = data.severity_low       || 0;
  const critBack = data.critical_alarms    || 0;
  const highBack = data.high_alarms        || 0;
  const intrusion= data.intrusion_attempts || 0;
  //const det = data.intrusion_details || { malware: 0, brute_force: 0, web_attack: 0 };
// Calcul du total normal
  const totalNormal = critical + high + medium + low;
  // Nouveaux compteurs de sévérité intrusion
  const intCrit  = data.int_crit || 0;
  const intHigh  = data.int_high || 0;

  setText('kpiTotal',     fmtNum(total));
  setText('kpiCritical',  fmtNum(critical));
  setText('kpiHigh',      fmtNum(high));
  setText('kpiMedium',    fmtNum(medium));
  setText('kpiLow',       fmtNum(low));
  setText('kpiIntrusion', fmtNum(intrusion));

  // Affichage du Total Normal dans le nouveau badge
  setText('totalNormal', `${fmtNum(totalNormal)} `);
  // --- MISE À JOUR DES NOUVEAUX IDS DANS LA CARTE VIOLETTE ---
  setText('int-crit', `${intCrit} Critical`);
  setText('int-high', `${intHigh} High`);
  
  const det = data.intrusion_details || { malware: 0, brute_force: 0, web_attack: 0, config_mod: 0, other: 0 };

  const updateDetail = (id, val, barId) => {
    const el = document.getElementById(id);
    if (el) el.textContent = ` : ${fmtNum(val)}`; // Ajout des deux-points
    
    const bar = document.getElementById(barId);
    if (bar) {
      const pct = intrusion > 0 ? (val / intrusion) * 100 : 0;
      bar.style.width = pct + '%';
    }
   };

    updateDetail('v-det-config',  det.config_mod,  'barConfig');
    updateDetail('v-det-malware', det.malware,     'barMalware');
    updateDetail('v-det-brute',   det.brute_force, 'barBrute');
    updateDetail('v-det-web',     det.web_attack,  'barWeb');
    //updateDetail('v-det-other',   det.other,       'barOther'); // Optionnel

  renderIntrusionChart(det);
    
  if (customDateFrom && customDateTo) {
    const df = customDateFrom.split('-').reverse().join('/');
    const dt = customDateTo.split('-').reverse().join('/');
    setText('kpiPeriod', `${df} → ${dt}`);
  } else {
    setText('kpiPeriod', `${currentDays} derniers jours`);
  }

  // Bannière — alertes backlog non traitées
  const banner = document.getElementById('criticalBanner');
  const bannerText = document.getElementById('criticalBannerText');
  if (data.api_error) {
    if (bannerText) {
      bannerText.textContent = data.api_error_message
        || "API LogRhythm injoignable depuis ce serveur. Vérifiez LR_BASE_URL (HTTPS) et le réseau.";
    }
    banner.style.display = 'flex';
  } else if (critBack > 0 || highBack > 0) {
    const parts = [];
    if (critBack > 0) parts.push(`${fmtNum(critBack)} critique(s) RR9`);
    if (highBack > 0) parts.push(`${fmtNum(highBack)} élevée(s) RR8`);
    if (bannerText) bannerText.textContent = `ATTENTION : ${parts.join(' • ')} non traitée(s) en backlog`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }

  setText('criticalCountBadge', critBack > 0 ? `${fmtNum(critBack)} crit.` : '');
  setText('highCountBadge',     highBack > 0 ? `${fmtNum(highBack)} élev.`  : '');
}

// ── Table — Alertes critiques & élevées non traitées ─────────────────────────
function renderCriticalAlarmsTable(data) {
  const list  = data.critical_list || [];
  const tbody = document.getElementById('criticalAlarmsBody');

  _criticalAlarms = [...list].sort((a, b) => (b.riskRating || 0) - (a.riskRating || 0));

  tbody.innerHTML = _criticalAlarms.map((alarm, idx) => {
    const date     = alarm.dateInserted ? alarm.dateInserted.replace('T', ' ').slice(0, 19) : '—';
    const badge    = statusBadge(alarm.alarmStatus);
    
    // --- NOUVEAU : Icône de bouclier si c'est une intrusion ---
    const intrusionIcon = alarm.isIntrusion 
      ? `<i class="fa-solid fa-shield-virus" style="color:#f87171; margin-right:8px;" title="Tentative d'Intrusion"></i>` 
      : '';

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
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="color:var(--green);text-align:center;padding:20px"><i class="fa-solid fa-check-circle"></i> Aucune alerte critique ou élevée non traitée</td></tr>';
}

// ── Métadonnées ───────────────────────────────────────────────────────────────
function renderLastUpdated(data) {
  if (data.last_updated) {
    const d   = new Date(data.last_updated);
    const str = d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    setText('lastUpdated', `MAJ : ${str}`);
  }
}

/**
 * Compte le nombre d'occurrences d'une valeur dans un tableau d'objets
 */
function countOccurrences(data, key) {
    if (!data) return {};
    return data.reduce((acc, item) => {
        const val = item[key];
        // On ignore les valeurs vides ou "N/A" pour la propreté du graphe
        if (val && val !== "N/A" && val !== "") {
            acc[val] = (acc[val] || 0) + 1;
        }
        return acc;
    }, {});
}

/**
 * Trie les résultats et les formate pour Chart.js (Labels + Values)
 */
function formatForChart(counts, limit = 10) {
    const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1]) // Trie du plus grand au plus petit
        .slice(0, limit);           // Garde le Top 10

    return {
        labels: sorted.map(s => s[0]),
        values: sorted.map(s => s[1])
    };
}

function downloadPdfReport() {
  let queryParams = "";

  const inputFrom = document.querySelector('#dateFrom, #startDate, input[name="date_from"]');
  const inputTo   = document.querySelector('#dateTo, #endDate, input[name="date_to"]');

  if (inputFrom && inputTo && inputFrom.value && inputTo.value) {
    let valFrom = inputFrom.value.trim();
    let valTo   = inputTo.value.trim();

    // Convertit JJ/MM/AAAA en AAAA-MM-JJ si nécessaire (ex: 03/08/2026 -> 2026-08-03)
    if (valFrom.includes('/')) {
      const parts = valFrom.split('/');
      if (parts.length === 3) valFrom = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    if (valTo.includes('/')) {
      const parts = valTo.split('/');
      if (parts.length === 3) valTo = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    queryParams = `date_from=${encodeURIComponent(valFrom)}&date_to=${encodeURIComponent(valTo)}`;
  } else {
    // Gestion identique pour les boutons de période (7j, 14j, 30j, 90j)
    const activeBtn = document.querySelector('.period-btn.active, [data-period].active, [data-days].active');
    const daysAttr = activeBtn ? (activeBtn.dataset.days || activeBtn.dataset.period || "30") : "30";
    const cleanDays = String(daysAttr).replace('d', '').replace('j', '');
    queryParams = `days=${cleanDays}`;
  }

  window.location.href = `/api/reports/download-pdf?${queryParams}`;
}


//------------
/*window.addEventListener('load', () => {
    fetch('/api/stats/top-impacted')
        .then(r => r.json())
        .then(data => {
            console.log("Data reçue:", data); 
            renderTopSourcesChart(data);
        })
        .catch(err => console.error("Erreur:", err));
});*/

/*window.addEventListener('load', () => {
    // 1. On récupère les éléments du DOM
    const loader = document.getElementById('loading-impacted');
    const loaderText = document.getElementById('loading-text');
    const canvas = document.getElementById('topImpactedChart');

    // 2. ON ALLUME LE LOADER
    if (loader) loader.style.display = 'block';
    if (loaderText) loaderText.style.display = 'block';
    if (canvas) canvas.style.opacity = '0.3'; // Effet visuel de chargement

    fetch('/api/stats/top-impacted')
        .then(r => r.json())
        .then(data => {
            console.log("Data reçue:", data); 
            renderTopSourcesChart(data);
        })
        .catch(err => {
            console.error("Erreur:", err);
            if (loaderText) loaderText.innerText = "Erreur de chargement des données.";
        })
        .finally(() => {
            // 3. ON ÉTEINT LE LOADER (Quoi qu'il arrive)
            if (loader) loader.style.display = 'none';
            if (loaderText && !loaderText.innerText.includes("Erreur")) {
                loaderText.style.display = 'none';
            }
            if (canvas) canvas.style.opacity = '1';
        });
});*/