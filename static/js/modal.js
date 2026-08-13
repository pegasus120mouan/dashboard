/* ══════════════════════════════════════════════════════════════════════
   modal.js — Modal de détail d'une alarme
   Drilldown : /api/drilldown/{id}  →  proxy Flask  →  /lr-alarm-api/alarms/{id}/events
   Dépend de : config.js, helpers.js
   Utilise : _criticalAlarms (défini dans main.js / events.js)
══════════════════════════════════════════════════════════════════════ */

function showAlarmDetail(idx) {
  const alarm = _criticalAlarms[idx];
  if (!alarm) return;

  const rr       = alarm.riskRating || 0;
  const meta     = RR_META[rr] || {};
  const date     = alarm.dateInserted ? alarm.dateInserted.replace('T', ' ').slice(0, 19) : '—';
  const sevLabel = alarm.severity || alarm.severityLabel || '';

  // En-tête
  document.getElementById('detailSevBadge').innerHTML   = classificationBadge(alarm.classification, rr);
  document.getElementById('detailRuleName').textContent = alarm.alarmRuleName || '—';

  // Méta-données
  document.getElementById('detailId').textContent     = `#${alarm.alarmId}`;
  document.getElementById('detailDate').textContent   = date;
  document.getElementById('detailClassif').innerHTML  = classificationBadge(alarm.classification, rr);
  document.getElementById('detailRR').textContent     = `${rr} / 9`;
  document.getElementById('detailEntity').textContent = alarm.entityName   || '—';
  document.getElementById('detailHost').textContent   = alarm.hostImpacted || '—';
  document.getElementById('detailStatus').innerHTML   = statusBadge(alarm.alarmStatus);
  //document.getElementById('detaildetip').textContent = alarm.destIps;

  let sevHtml;
  if      (sevLabel === 'critical') sevHtml = `<span class="badge badge-rr9"><i class="fa-solid fa-circle-exclamation"></i> Critique</span>`;
  else if (sevLabel === 'high')     sevHtml = `<span class="badge badge-rr8"><i class="fa-solid fa-triangle-exclamation"></i> Élevée</span>`;
  else if (sevLabel === 'medium')   sevHtml = `<span class="badge badge-rr6"><i class="fa-solid fa-circle-half-stroke"></i> Moyenne</span>`;
  else                              sevHtml = `<span class="badge badge-rr0"><i class="fa-solid fa-circle"></i> Faible</span>`;
  document.getElementById('detailSeverity').innerHTML = sevHtml;

  // Bloc RR info 
  document.getElementById('detailRRLevel').textContent    = meta.level    || '—';
  document.getElementById('detailRRMeaning').textContent  = meta.meaning  || '—';
  document.getElementById('detailRRTransfer').textContent = meta.transfer || '—';

  // Affiche le modal
  document.getElementById('alarmDetailOverlay').classList.add('active');

  // Drilldown lazy — /api/drilldown/{id} → Flask → /lr-alarm-api/alarms/{id}/events
  if (!alarm.alarmId) {
    document.getElementById('drilldownLoading').style.display = 'none';
    document.getElementById('drilldownError').style.display   = 'flex';
    return;
  }

  fetch(`/api/drilldown/${alarm.alarmId}`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(dd => {
      if (!document.getElementById('alarmDetailOverlay').classList.contains('active')) return;

      const hasData = (dd.eventCount > 0)
        || (dd.sourceHosts && dd.sourceHosts.length)
        || (dd.destHosts   && dd.destHosts.length)
        || (dd.sourceIps   && dd.sourceIps.length)
        || (dd.destIps     && dd.destIps.length)
        || (dd.users       && dd.users.length);

      if (!hasData) {
        document.getElementById('drilldownLoading').style.display = 'none';
        document.getElementById('drilldownError').style.display   = 'flex';
        return;
      }

      renderDrilldownChips('ddSourceHosts', dd.sourceHosts, 'chip-host');
      renderDrilldownChips('ddDestHosts',   dd.destHosts,   'chip-host');
      renderDrilldownChips('ddSourceIps',   dd.sourceIps,   'chip-ip');
      renderDrilldownChips('ddDestIps',     dd.destIps,     'chip-ip');
      renderDrilldownChips('ddUsers',       dd.users,       'chip-user');

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

function closeAlarmDetail() {
  document.getElementById('alarmDetailOverlay').classList.remove('active');
}

// Bloc action
  // const actionEl = document.getElementById('detailAction');
  // actionEl.className = `detail-action ${meta.cls || ''}`;
  // document.getElementById('detailActionIcon').className   = `fa-solid ${meta.icon || 'fa-bolt'}`;
  // document.getElementById('detailActionTitle').textContent = meta.action || '';
  // document.getElementById('detailActionDesc').textContent  = meta.desc   || '';

  // Réinitialise le drilldown
  // document.getElementById('drilldownLoading').style.display = 'flex';
  // document.getElementById('drilldownData').style.display    = 'none';
  // document.getElementById('drilldownError').style.display   = 'none';