"""
Package logrhythm — client SOC pour LogRhythm SIEM.

Structure :
  constants.py  — données de référence (classifications, statuts, RR)
  classify.py   — logique de classification des alarmes
  auth.py       — authentification et client HTTP bas niveau
  client.py     — appels API métier (fetch_alarms, fetch_drilldown, fetch_cases)
  metrics.py    — calcul des métriques dashboard

L'ensemble des symboles publics est ré-exporté ici pour maintenir
la compatibilité avec les imports existants (app.py, export_alarms.py).
"""

from .constants import (
    ALARM_STATUS,
    BACKLOG_STATUSES,
    FALSE_POS_STATUSES,
    TRUE_POS_STATUSES,
    LR_CLASSIFICATIONS,
    CLASSIFICATION_KEYWORDS,
    INTRUSION_KEYWORDS,
    RR_CRITICAL,
    RR_HIGH,
)
from .classify import classify_alarm, get_severity
from .auth     import _get, _headers, BASE_URL
from .client   import fetch_alarms, fetch_drilldown, fetch_cases
from .metrics  import compute_metrics, compute_metrics_from_file

__all__ = [
    "ALARM_STATUS", "BACKLOG_STATUSES", "FALSE_POS_STATUSES", "TRUE_POS_STATUSES",
    "LR_CLASSIFICATIONS", "CLASSIFICATION_KEYWORDS", "INTRUSION_KEYWORDS",
    "RR_CRITICAL", "RR_HIGH",
    "classify_alarm", "get_severity",
    "_get", "_headers", "BASE_URL",
    "fetch_alarms", "fetch_drilldown", "fetch_cases",
    "compute_metrics", "compute_metrics_from_file",
]
