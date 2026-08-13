/* ══════════════════════════════════════════════════════════════════════
   events.js — Page Events : liste filtrée de toutes les alarmes
   Dépend de : config.js, helpers.js, period.js, modal.js
══════════════════════════════════════════════════════════════════════ */

const PAGE_SIZE = 50;

let _criticalAlarms  = [];   // tableau indexé pour le modal (modal.js)
let _allAlarms       = [];   // toutes les alarmes renvoyées par l'API
let _filtered        = [];   // après filtre sévérité + recherche texte
let _currentSeverity = 'all';
let _searchText      = '';
let _currentPage     = 1;

// ── Lecture des params URL (sévérité initiale) ────────────────────────────────
(function () {
  const p = new URLSearchParams(window.location.search);
  const s = p.get('severity');
  if (s) _currentSeverity = s.toLowerCase();
})();

// ── Callback requis par period.js ─────────────────────────────────────────────
function _loadPageData(days, dateFrom, dateTo) {
  loadEvents(false);
}

function refreshData() {
  spinRefresh();
  loadEvents(true);
}

// ── Chargement des alarmes ────────────────────────────────────────────────────
function loadEvents(force = false) {
  document.getElementById('evLoader').style.display = 'flex';
  document.getElementById('eventsBody').innerHTML   = '';

  fetch(buildApiUrl('/api/alarms', force))
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => {
      _allAlarms = data.alarms || [];
      document.getElementById('evLoader').style.display = 'none';

      // Mise à jour last_updated header
      if (data.last_updated) {
        const d   = new Date(data.last_updated);
        const str = d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        setText('lastUpdated', `MAJ : ${str}`);
      }

      updateCounts();
      applyFilters();
    })
    .catch(err => {
      document.getElementById('evLoader').style.display = 'none';
      document.getElementById('eventsBody').innerHTML =
        `<tr><td colspan="8" style="color:var(--red);text-align:center;padding:24px">
           <i class="fa-solid fa-circle-xmark"></i> Erreur : ${escHtml(err.message)}
         </td></tr>`;
    });
}

// ── Comptages par sévérité (pour les badges des onglets) ─────────────────────
function updateCounts() {
  const counts = { 
    all: _allAlarms.length, 
    critical: 0, high: 0, medium: 0, low: 0, 
    intrusion_crit: 0, intrusion_high: 0 
  };

  _allAlarms.forEach(a => {
    const rr = parseInt(a.riskRating) || 0;
    const isInt = (a.isIntrusion === true || a.isIntrusion === "true");

    if (isInt) {
      // --- GROUPE TENTATIVES D'INTRUSION ---
      if (rr >= 9) counts.intrusion_crit++;
      else if (rr === 8) counts.intrusion_high++;
    } 
    else {
      // --- GROUPE ALERTES NORMALES ---
      if (rr >= 9)      counts.critical++;
      else if (rr === 8) counts.high++;
      else if (rr >= 5) counts.medium++;
      else               counts.low++;
    }
  });

  // Mise à jour des éléments HTML
  const mapping = {
    'all': counts.all,
    'critical': counts.critical,      // Affichera 19
    'high': counts.high,              // Affichera 8
    'medium': counts.medium,          // Affichera 2
    'low': counts.low,                // Affichera 2
    'intrusion_crit': counts.intrusion_crit, // Affichera 624
    'intrusion_high': counts.intrusion_high  // Affichera 123
  };

  Object.entries(mapping).forEach(([id, val]) => {
    const el = document.getElementById(`evCount-${id}`);
    if (el) el.textContent = fmtNum(val);
  });
}
// ── Filtrage sévérité + texte ─────────────────────────────────────────────────
function applyFilters() {
  const search = _searchText.toLowerCase();

  _filtered = _allAlarms.filter(a => {
    const rr = parseInt(a.riskRating) || 0;
    const isInt = (a.isIntrusion === true || a.isIntrusion === "true");

    // 1. FILTRE PAR ONGLET (SÉVÉRITÉ)
    if (_currentSeverity === 'intrusion_crit') {
      if (!isInt || rr < 9) return false;
    } 
    else if (_currentSeverity === 'intrusion_high') {
      if (!isInt || rr !== 8) return false;
    }
    else if (_currentSeverity === 'critical') {
      if (isInt || rr < 9) return false; // Exclut les 624 intrusions
    }
    else if (_currentSeverity === 'high') {
      if (isInt || rr !== 8) return false; // Exclut les 123 intrusions
    }
    else if (_currentSeverity === 'medium') {
      if (isInt || rr < 5 || rr >= 8) return false;
    }
    else if (_currentSeverity === 'low') {
      if (isInt || rr >= 5) return false;
    }

    // 2. FILTRE RECHERCHE TEXTE
    if (search) {
      const haystack = [a.alarmRuleName, a.entityName, a.hostImpacted].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });

  _currentPage = 1;
  renderPage();
}

// ── Rendu de la page courante ─────────────────────────────────────────────────
function renderPage() {
  const total   = _filtered.length;
  const pages   = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start   = (_currentPage - 1) * PAGE_SIZE;
  const slice   = _filtered.slice(start, start + PAGE_SIZE);

  // Indexer pour le modal
  _criticalAlarms = _filtered;

  // Résultat count
  const from = total === 0 ? 0 : start + 1;
  const to   = Math.min(start + PAGE_SIZE, total);
  setText('evResultCount', `${fmtNum(from)}–${fmtNum(to)} sur ${fmtNum(total)} alarme(s)`);

  // Tableau
  const tbody = document.getElementById('eventsBody');
  if (slice.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--text-muted);text-align:center;padding:32px">
      <i class="fa-solid fa-inbox" style="font-size:24px;margin-bottom:8px;display:block"></i>
      Aucune alarme pour ce filtre
    </td></tr>`;
  } else {
    tbody.innerHTML = slice.map((alarm, i) => {
      const globalIdx = start + i;
      const date      = alarm.dateInserted ? alarm.dateInserted.replace('T', ' ').slice(0, 19) : '—';
      const rrBadge   = rrSeverityBadge(alarm.severityLabel, alarm.riskRating);
      // On ajoute un petit bouclier violet si c'est une intrusion
      const intrusionIcon = alarm.isIntrusion 
        ? `<i class="fa-solid fa-shield-virus" style="color:#a78bfa; margin-right:8px;" title="Tentative d'intrusion"></i>` 
        : '';

      return `<tr class="alarm-row-clickable" onclick="showAlarmDetail(${globalIdx})" title="Voir les détails">
        <td style="color:var(--text-muted);font-size:12px">#${alarm.alarmId || '—'}</td>
        <td style="max-width:280px;word-break:break-word">${escHtml(alarm.alarmRuleName)}</td>
        <td>${escHtml(alarm.entityName)}</td>
        
        <td>${classificationBadge(alarm.classification, alarm.riskRating)}</td>
        <td>${rrBadge}</td>
        <td>${statusBadge(alarm.alarmStatus)}</td>
        <td style="color:var(--text-muted);font-size:12px;white-space:nowrap">${date}</td>
      </tr>`;
    }).join('');
  }

  // Pagination
  const prevBtn  = document.getElementById('evPrevBtn');
  const nextBtn  = document.getElementById('evNextBtn');
  const pageInfo = document.getElementById('evPageInfo');
  prevBtn.disabled  = (_currentPage <= 1);
  nextBtn.disabled  = (_currentPage >= pages);
  pageInfo.textContent = `Page ${_currentPage} / ${pages}`;
  document.getElementById('evPagination').style.display = pages <= 1 ? 'none' : 'flex';
}

// ── Pagination ────────────────────────────────────────────────────────────────
function changePage(delta) {
  const pages = Math.ceil(_filtered.length / PAGE_SIZE);
  _currentPage = Math.max(1, Math.min(pages, _currentPage + delta));
  renderPage();
  document.getElementById('mainContent').scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Onglets de sévérité ───────────────────────────────────────────────────────
function setActiveSevTab(severity) {
  _currentSeverity = severity;
  document.querySelectorAll('.ev-sev-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.severity === severity);
  });
  applyFilters();
}

// ── Recherche ─────────────────────────────────────────────────────────────────
function clearSearch() {
  document.getElementById('evSearchInput').value = '';
  _searchText = '';
  document.getElementById('evSearchClear').style.display = 'none';
  applyFilters();
}

// ── Badge RR compact ──────────────────────────────────────────────────────────
function rrSeverityBadge(severityLabel, rr) {
  const map = { critical: 'badge-rr9', high: 'badge-rr8', medium: 'badge-rr6', low: 'badge-rr0' };
  const cls = map[severityLabel] || 'badge-rr0';
  return `<span class="badge ${cls}">${rr ?? '?'}</span>`;
}

// ── Init DOM ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Activer l'onglet sévérité depuis l'URL
  document.querySelectorAll('.ev-sev-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.severity === _currentSeverity);
    btn.addEventListener('click', () => setActiveSevTab(btn.dataset.severity));
  });

  // Champ de recherche
  const searchInput = document.getElementById('evSearchInput');
  const clearBtn    = document.getElementById('evSearchClear');
  searchInput.addEventListener('input', () => {
    _searchText = searchInput.value.trim();
    clearBtn.style.display = _searchText ? 'flex' : 'none';
    applyFilters();
  });
});
