/* ══════════════════════════════════════════════════════════════════════
   period.js — Sélecteur de période partagé (Dashboard + Events)
   Expose : currentDays, customDateFrom, customDateTo
   Appelle : _loadPageData(days, dateFrom, dateTo)  — défini par chaque page
             refreshData()                          — défini par chaque page
══════════════════════════════════════════════════════════════════════ */

// ── État partagé ──────────────────────────────────────────────────────────────
let currentDays    = 30;
let customDateFrom = null;
let customDateTo   = null;
let fpFrom         = null;
let fpTo           = null;

// Lecture du paramètre ?days= dans l'URL au chargement du script
(function () {
  const p = new URLSearchParams(window.location.search);
  const d = p.get('days');
  if (d && !isNaN(parseInt(d))) currentDays = parseInt(d);
  const df = p.get('date_from');
  const dt = p.get('date_to');
  if (df && dt) {
    customDateFrom = df;
    customDateTo   = dt;
  }
})();

// ── Init DOM ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // ── Boutons de période rapide
  document.querySelectorAll('.period-btn').forEach(btn => {
    if (!customDateFrom && parseInt(btn.dataset.days) === currentDays) {
      btn.classList.add('active');
    }
    if (customDateFrom) btn.classList.add('dimmed');

    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active', 'dimmed'));
      btn.classList.add('active');
      currentDays    = parseInt(btn.dataset.days);
      customDateFrom = null;
      customDateTo   = null;
      if (fpFrom) fpFrom.clear();
      if (fpTo)   fpTo.clear();
      document.getElementById('btnApply').disabled = true;
      document.getElementById('btnClearRange').style.display = 'none';
      _loadPageData(currentDays, null, null);
    });
  });

  // ── Flatpickr — "Du"
  fpFrom = flatpickr('#dateFrom', {
    locale: 'fr', dateFormat: 'd/m/Y', maxDate: 'today',
    defaultDate: customDateFrom ? customDateFrom.replace(/-/g, '/').split('/').reverse().join('/') : null,
    onChange(selectedDates) {
      customDateFrom = selectedDates.length ? isoDate(selectedDates[0]) : null;
      if (fpTo) fpTo.set('minDate', selectedDates.length ? selectedDates[0] : null);
      updateApplyBtn();
    }
  });

  // ── Flatpickr — "Au"
  fpTo = flatpickr('#dateTo', {
    locale: 'fr', dateFormat: 'd/m/Y', maxDate: 'today',
    defaultDate: customDateTo ? customDateTo.replace(/-/g, '/').split('/').reverse().join('/') : null,
    onChange(selectedDates) {
      customDateTo = selectedDates.length ? isoDate(selectedDates[0]) : null;
      updateApplyBtn();
    }
  });

  // Si on a des dates depuis l'URL, afficher le bouton clear et désactiver les period-btn
  if (customDateFrom && customDateTo) {
    document.getElementById('btnClearRange').style.display = 'inline-flex';
    updateApplyBtn();
  }

  // ── Footer horloge
  updateFooterTime();
  setInterval(updateFooterTime, 1000);

  // ── Fermeture modal au clavier
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAlarmDetail();
  });

  // ── Chargement initial des données de la page
  _loadPageData(currentDays, customDateFrom, customDateTo);

  // ── Auto-refresh toutes les 30 min
  setInterval(() => _loadPageData(
    customDateFrom ? null : currentDays,
    customDateFrom,
    customDateTo
  ), 30 * 60 * 1000);
});

// ── Plage personnalisée ───────────────────────────────────────────────────────
function applyCustomRange() {
  if (!customDateFrom || !customDateTo) return;
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.remove('active');
    b.classList.add('dimmed');
  });
  document.getElementById('btnClearRange').style.display = 'inline-flex';
  _loadPageData(null, customDateFrom, customDateTo);
}

function clearCustomRange() {
  customDateFrom = null;
  customDateTo   = null;
  if (fpFrom) fpFrom.clear();
  if (fpTo)   fpTo.clear();
  document.getElementById('btnApply').disabled = true;
  document.getElementById('btnClearRange').style.display = 'none';
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.remove('dimmed');
    if (parseInt(b.dataset.days) === currentDays) b.classList.add('active');
  });
  _loadPageData(currentDays, null, null);
}

function updateApplyBtn() {
  document.getElementById('btnApply').disabled = !(customDateFrom && customDateTo);
}

// ── Utilitaires ───────────────────────────────────────────────────────────────
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildApiUrl(base, force = false) {
  const forceStr = force ? 'true' : 'false';
  if (customDateFrom && customDateTo) {
    return `${base}?date_from=${customDateFrom}&date_to=${customDateTo}&force=${forceStr}`;
  }
  return `${base}?days=${currentDays}&force=${forceStr}`;
}

function spinRefresh(ms = 1500) {
  const icon = document.getElementById('refreshIcon');
  if (icon) {
    icon.classList.add('fa-spin');
    setTimeout(() => icon.classList.remove('fa-spin'), ms);
  }
}
