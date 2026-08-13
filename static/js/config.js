/* ══════════════════════════════════════════════════════════════════════
   config.js — Constantes globales et configuration Chart.js
   Doit être chargé EN PREMIER.
══════════════════════════════════════════════════════════════════════ */

// ── Configuration Chart.js globale ───────────────────────────────────────────
Chart.defaults.color       = '#7d97b8';
Chart.defaults.borderColor = 'rgba(120, 160, 210, 0.12)';
Chart.defaults.font.family = "'Outfit', 'Segoe UI', system-ui, sans-serif";
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.elements.arc.borderWidth = 0;
Chart.defaults.elements.line.tension = 0.35;
Chart.defaults.elements.point.radius = 3;
Chart.defaults.elements.point.hoverRadius = 5;

// ── Palette de couleurs ───────────────────────────────────────────────────────
const COLORS = {
  red:    '#ff4d5a',  redA:    'rgba(255,77,90,0.72)',
  orange: '#ff9a3c',  orangeA: 'rgba(255,154,60,0.72)',
  green:  '#2ee59d',  greenA:  'rgba(46,229,157,0.72)',
  blue:   '#4d9fff',  blueA:   'rgba(77,159,255,0.72)',
  purple: '#b57bff',  purpleA: 'rgba(181,123,255,0.72)',
  yellow: '#f5c542',  yellowA: 'rgba(245,197,66,0.72)',
  cyan:   '#2ee6f0',  cyanA:   'rgba(46,230,240,0.72)',
  pink:   '#e05c8a',  pinkA:   'rgba(224,92,138,0.72)',
};

// ── Classifications LogRhythm (14 types — référentiel v7.23.0) ───────────────
const CLASSIFICATION_COLORS = {
  'Compromise':               COLORS.red,
  'Malware':                  COLORS.purple,
  'Attack':                   COLORS.orange,
  'Denial of Service':        '#d04000',
  'Suspicious':               COLORS.yellow,
  'Misuse':                   COLORS.pink,
  'Reconnaissance':           COLORS.cyan,
  'Activity':                 COLORS.blue,
  'Failed Attack':            '#3d5570',
  'Failed Denial of Service': '#4a4060',
  'Failed Malware':           '#4a3060',
  'Failed Suspicious':        '#3a4a50',
  'Failed Activity':          '#304050',
  'Other Security':           '#3a4a5a',
};

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

// ── Référentiel Risk Rating → métadonnées modal ───────────────────────────────
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
