"""
Appels API LogRhythm de haut niveau.
fetch_alarms, fetch_drilldown, fetch_cases.
"""

import os
import time
from .auth import _get

_BATCH = 500   # alarmes par page

FORENSIC_CACHE = {}

def fetch_alarms(date_from: str, date_to: str, limit: int  | None = None) -> list:
    """
    Récupère les alarmes par pages jusqu'à tout avoir (limit=None)
    ou jusqu'à atteindre `limit` alarmes.
    """
    collected: list = []
    offset = 0

    while True:
        page_size = min(_BATCH, limit - len(collected)) if limit else _BATCH

        data = _get(
            "/lr-alarm-api/alarms",
            {
                "count":              page_size,
                "offset":             offset,
                "orderby":            "DateInserted",
                "dir":                "descending",
                "dateInserted":       date_from,
                "dateInserted_end":   date_to,
            },
        )
        if not data:
            if offset == 0:
                raise ConnectionError(
                    f"API LogRhythm injoignable ({os.getenv('LR_BASE_URL', '')})"
                )
            break

        raw = data.get("alarmsSearchDetails", [])
        if not raw:
            break

        # Normalise les bornes : supprime le suffixe Z pour comparer avec
        # le format dateInserted de l'API ("2026-02-01T09:00:00.217", sans Z)
        _from = date_from.rstrip("Zz")
        _to   = date_to.rstrip("Zz")

        # Filtre Python : double borne pour garantir la plage même si l'API l'ignore
        page = [
            a for a in raw
            if _from <= a.get("dateInserted", "") <= _to
        ]

        # Optimisation : les résultats étant triés par date desc,
        # dès que la plus ancienne alarme de la page est antérieure à date_from
        # on peut s'arrêter — il n'y aura plus rien dans la plage.
        oldest = raw[-1].get("dateInserted", "")
        if oldest < _from:
            collected.extend(page)
            break

        # Ne pas arrêter si page est vide : la page peut contenir des alarmes
        # plus récentes que date_to (ex: mars alors qu'on cherche février).
        # On continue la pagination jusqu'à atteindre la plage voulue.
        collected.extend(page)

        if (limit and len(collected) >= limit) or len(raw) < page_size:
            break

        offset += page_size

    return collected[:limit] if limit else collected


def fetch_drilldown(alarm_id: int) -> dict:
    """
    Appelle /lr-alarm-api/alarms/{alarmId}/events et extrait
    les hôtes, IPs et utilisateurs impliqués dans l'alarme.
    """
    data = _get(f"/lr-alarm-api/alarms/{alarm_id}/events", timeout=8)
    if not data:
        return {}

    events = (
        data.get("alarmEventsDetails")
        or data.get("events")
        or data.get("alarmEvents")
        or (data if isinstance(data, list) else [])
    )

    source_hosts: set = set()
    dest_hosts:   set = set()
    source_ips:   set = set()
    dest_ips:     set = set()
    users:        set = set()

    _EMPTY = {"-", "N/A", "n/a", "none", "None", ""}

    for evt in events:
        if not isinstance(evt, dict):
            continue
        
        #for fld in ("sourceHostName", "logSourceHostName", "originHostName"):
            #v = evt.get(fld)
            #if v and v not in _EMPTY:
                #source_hosts.add(v); break
        
        for fld in ("destinationHostName","destinationHost","destinationName", "impactedHost","impactedHostName", "destHostName","destHost", "destHosts","destName"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                dest_hosts.add(v); break
        
        for fld in ("impactedHostName", "impactedName", "destinationHostName"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                dest_hosts.add(v); break

        for fld in ("originHostName", "originHost"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                source_hosts.add(v); break        

        for fld in ("originIP"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                source_ips.add(v); break
        
        for fld in ("destinationIp", "destIp", "impactedIp", "dstIp", "destinationIPAddress"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                dest_ips.add(v); break
        
        for fld in ("login","userName", "user", "account", "login", "subject"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                users.add(v); break

    return {
        "sourceHosts": sorted(source_hosts)[:5],
        "destHosts":   sorted(dest_hosts)[:5],
        "sourceIps":   sorted(source_ips)[:5],
        "destIps":     sorted(dest_ips)[:5],
        "users":       sorted(users)[:5],
        "eventCount":  len(events),
        "alarmEventsDetails": events
    }

def fetch_cases(date_from: str, date_to: str, count: int = 500) -> list:
    data = _get(
        "/lr-case-api/cases",
        {
            "count":        count,
            "offset":       0,
            "orderBy":      "dateCreated",
            "direction":    "desc",
            "createdAfter": date_from,
            "createdBefore": date_to,
        },
    )
    if not data:
        return []
    return data if isinstance(data, list) else data.get("cases", [])


def fetch_case_by_id(case_id: str) -> dict:
    """
    Récupère les détails précis d'un dossier unique depuis l'API LogRhythm.
    Route : GET /lr-case-api/cases/{caseId}
    """
    # Construction dynamique de l'URL avec le GUID du dossier
    endpoint = f"/lr-case-api/cases/{case_id}"
    
    # Appel de ton utilitaire de requêtes habituel
    data = _get(endpoint)
    
    # L'API renvoie un dictionnaire JSON représentant le dossier, ou None en cas d'échec
    if not data or not isinstance(data, dict):
        return {}
        
    return data

#-----------------------------------
import threading
from concurrent.futures import ThreadPoolExecutor

_EMPTY_FORENSIC = {"-", "N/A", "n/a", "none", "None", ""}
_drilldown_lock = threading.Lock()
_drilldown_consecutive_fails = 0
_DRILLDOWN_GIVE_UP = 4


def _clean_val(value, default="N/A"):
    if value is None:
        return default
    text = str(value).strip()
    return default if text in _EMPTY_FORENSIC else text


def _forensic_from_alarm(alarm):
    """Champs forensic à partir de la liste d'alarmes (sans /events)."""
    return {
        "id": str(alarm.get("alarmId") or ""),
        "type": _clean_val(
            alarm.get("alarmRuleName") or alarm.get("classification") or alarm.get("alarmName"),
            "Inconnu",
        ),
        "source": _clean_val(alarm.get("entityName")),
        "impacted": _clean_val(
            alarm.get("hostImpacted")
            or alarm.get("impactedHostName")
            or alarm.get("entityName")
        ),
        "cve": _clean_val(alarm.get("cve"), ""),
        "severity": alarm.get("severityLabel"),
    }


def get_full_forensic_data(alarm_list):
    """
    Analyse profonde de chaque alarme pour extraire les artefacts.
    Si /events est indisponible (prod publique), on retombe sur les champs alarme.
    """
    if not alarm_list:
        return []

    def process_alarm(alarm):
        global _drilldown_consecutive_fails
        alarm_id = str(alarm.get("alarmId") or "")
        fallback = _forensic_from_alarm(alarm)

        if alarm_id in FORENSIC_CACHE:
            return FORENSIC_CACHE[alarm_id]

        with _drilldown_lock:
            skip_events = _drilldown_consecutive_fails >= _DRILLDOWN_GIVE_UP

        if skip_events:
            FORENSIC_CACHE[alarm_id] = fallback
            return fallback

        try:
            details = fetch_drilldown(alarm_id)
            events_list = (details or {}).get("alarmEventsDetails") or []
            if not details or not events_list:
                with _drilldown_lock:
                    _drilldown_consecutive_fails += 1
                FORENSIC_CACHE[alarm_id] = fallback
                return fallback

            with _drilldown_lock:
                _drilldown_consecutive_fails = 0

            event = events_list[0] if isinstance(events_list[0], dict) else {}

            source = "N/A"
            if details.get("sourceHosts"):
                source = details["sourceHosts"][0]
            elif details.get("sourceIps"):
                source = details["sourceIps"][0]
            else:
                source = event.get("sourceHostName") or event.get("sourceIP") or fallback["source"]

            if details.get("destHosts"):
                impacted = details["destHosts"][0]
            elif details.get("destIps"):
                impacted = details["destIps"][0]
            else:
                impacted = (
                    event.get("destinationHostName")
                    or event.get("destinationIP")
                    or fallback["impacted"]
                )

            cve_event = event.get("cve") or ""
            cve_alarm = alarm.get("cve") or ""
            result = {
                "id": alarm_id,
                "type": _clean_val(
                    event.get("commonEventName") or fallback["type"],
                    "Inconnu",
                ),
                "source": _clean_val(source, fallback["source"]),
                "impacted": _clean_val(impacted, fallback["impacted"]),
                "cve": (cve_event.strip() if isinstance(cve_event, str) else "")
                or (cve_alarm.strip() if isinstance(cve_alarm, str) else ""),
                "severity": alarm.get("severityLabel"),
            }
            FORENSIC_CACHE[alarm_id] = result
            return result

        except Exception as e:
            print(f"Erreur sur alarme {alarm_id}: {e}")
            with _drilldown_lock:
                _drilldown_consecutive_fails += 1
            FORENSIC_CACHE[alarm_id] = fallback
            return fallback

    with ThreadPoolExecutor(max_workers=12) as executor:
        results = list(executor.map(process_alarm, alarm_list))

    return [r for r in results if r is not None]