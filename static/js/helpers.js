/* ══════════════════════════════════════════════════════════════════════
   helpers.js — Fonctions utilitaires pures (UI + données)
   Dépend de : config.js
══════════════════════════════════════════════════════════════════════ */

// ── Formatage des données ─────────────────────────────────────────────────────
function fmtNum(n)    { return (n || 0).toLocaleString('fr-FR'); }
function pct(v, t)    { return t ? Math.round(v / t * 100) : 0; }
function escHtml(s)   { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── Manipulation DOM ──────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showLoader(show) {
  document.getElementById('loader').style.display = show ? 'flex' : 'none';
}

function showError(msg) {
  document.getElementById('criticalBanner').style.display = 'flex';
  document.getElementById('criticalBannerText').textContent = msg;
  document.getElementById('mainContent').style.display = 'flex';
}

function updateFooterTime() {
  const el = document.getElementById('footerTime');
  if (el) el.textContent = new Date().toLocaleString('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// ── Chart.js ──────────────────────────────────────────────────────────────────
function destroyChart(canvasId) {
  const existing = Chart.getChart(canvasId);
  if (existing) existing.destroy();
}

// ── Composants HTML réutilisables ─────────────────────────────────────────────
function statusBadge(status) {
  const s = (status || '').toLowerCase();
  let cls = 'badge-status-other';
  if (s === 'new')             cls = 'badge-status-new';
  else if (s.startsWith('open'))   cls = 'badge-status-open';
  else if (s.startsWith('closed')) cls = 'badge-status-closed';
  return `<span class="badge ${cls}">${escHtml(status)}</span>`;
}

function progressBar(p) {
  return `<div class="progress-bar">
    <div class="progress-track"><div class="progress-fill" style="width:${p}%"></div></div>
    <span class="progress-label">${p}%</span>
  </div>`;
}

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

// ── Classification côté front (miroir du référentiel LR v7.23.0) ─────────────
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
