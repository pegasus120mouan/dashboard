"""
Calcul des métriques SOC depuis l'API ou depuis un fichier JSON local.
"""
import os
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone

from .constants import (
    ALARM_STATUS, BACKLOG_STATUSES, FALSE_POS_STATUSES, TRUE_POS_STATUSES,
    INTRUSION_KEYWORDS, MONITORED_ENTITIES,
)
from .classify import classify_alarm, get_severity
from .client import fetch_alarms, fetch_cases


# ── Helpers drilldown ─────────────────────────────────────────────────────────
def _extract_info_from_events(events: list) -> dict:
    """Extrait hosts/IPs/users depuis une liste d'events (mode local)."""
    source_hosts: set = set()
    dest_hosts:   set = set()
    source_ips:   set = set()
    dest_ips:     set = set()
    users:        set = set()
    _EMPTY = {"-", "N/A", "n/a", "none", "None", ""}

    for evt in events:
        if not isinstance(evt, dict):
            continue
        for fld in ("sourceHostName", "logSourceHostName", "originHostName"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                source_hosts.add(v); break
        for fld in ("destinationHostName", "impactedHostName", "destHostName"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                dest_hosts.add(v); break
        for fld in ("sourceIp", "sourceIPAddress", "originIp", "srcIp"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                source_ips.add(v); break
        for fld in ("destinationIp", "destIp", "impactedIp", "dstIp", "destinationIPAddress"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                dest_ips.add(v); break
        for fld in ("userName", "user", "account", "login", "subject"):
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
    }


# ── Logique commune de calcul ────────────────────────────────────────────────
def _compute_from_alarms(alarms: list, date_from: str, date_to: str, cases: list | None = None) -> dict:
    """
    Calcule toutes les métriques à partir d'une liste d'alarmes brutes.
    Factorisation partagée par compute_metrics() et compute_metrics_from_file().
    """
    if cases is None:
        cases = []

    total           = len(alarms)
    
    backlog_count   = 0
    false_pos_count = 0
    true_pos_count  = 0
    critical_count  = 0   # backlog RR≥9 (pour la table + bannière)
    high_count      = 0   # backlog RR=8 (pour la table + bannière)
    intrusion_count = 0
    # Distribution de sévérité sur TOUTES les alarmes (pour les KPI Alertes normales)
    sev_critical    = 0   # RR ≥ 9
    sev_high        = 0   # RR = 8
    sev_medium      = 0   # RR 5–7
    sev_low         = 0   # RR < 5

    int_crit = 0  # Sous-compteur RR9 pour intrusion
    int_high = 0  # Sous-compteur RR8 pour intrusion

    status_counts  = Counter()
    entity_counts  = Counter()
    rule_counts    = Counter()
    classif_counts = Counter()
    daily_counts   = defaultdict(int)
    daily_crit     = defaultdict(int)
    daily_high     = defaultdict(int)
    daily_medium   = defaultdict(int)
    daily_low      = defaultdict(int)
    entity_daily: dict = defaultdict(lambda: defaultdict(int))
    critical_list  = []
    alarm_list     = []   # toutes les alarmes (pour /api/alarms + page Events)

    intrusion_details = {
        "config_mod": 0,
        "malware": 0,
        "brute_force": 0,
        "web_attack": 0
        #"other": 0
    }

    critical_list, alarm_list = [], []

    for alarm in alarms:
        classification, rr, is_intrusion_raw = classify_alarm(alarm)

        status_int = alarm.get("alarmStatus", -1)
        status_lbl = ALARM_STATUS.get(status_int, f"Inconnu ({status_int})")
        rule_name  = alarm.get("alarmRuleName", "Unknown")
        entity     = alarm.get("entityName", "Unknown")
        date_ins   = alarm.get("dateInserted", "")
        rule_lower = rule_name.lower()
        #classification, rr = classify_alarm(alarm)

        # LOGIQUE INTRUSION (C'est ici que ça se joue pour ton client)
        # --- LOGIQUE D'EXCLUSION ET TRI PAR MOTS-CLÉS ---
        # 2. Ta logique de filtrage par "Piliers" (La seule qui compte pour le dash)
        is_pillar_intrusion = False
        
        if is_intrusion_raw:
            if "config" in rule_lower or "modified" in rule_lower:
                intrusion_details["config_mod"] += 1
                is_pillar_intrusion = True
            elif any(k in rule_lower for k in ["malware", "virus", "trojan", "ransomware"]):
                intrusion_details["malware"] += 1
                is_pillar_intrusion = True
            elif any(k in rule_lower for k in ["brute", "guessing", "spray", "login"]):
                intrusion_details["brute_force"] += 1
                is_pillar_intrusion = True
            elif any(k in rule_lower for k in ["web", "sql", "xss", "http", "injection"]):
                intrusion_details["web_attack"] += 1
                is_pillar_intrusion = True


        # --- AIGUILLAGE FINAL ---
        if is_pillar_intrusion:
            intrusion_count += 1
            if rr >= 9: int_crit += 1
            else:       int_high += 1
        else:
            # Si c'est pas une intrusion pilier, ça VA obligatoirement en alerte normale
            if   rr >= 9: sev_critical += 1
            elif rr >= 8: sev_high     += 1
            elif rr >= 5: sev_medium   += 1
            else:         sev_low      += 1


        status_counts[status_lbl]      += 1
        entity_counts[entity]          += 1
        rule_counts[rule_name]         += 1
        classif_counts[classification] += 1

        if date_ins:
            day = date_ins[:10]
            daily_counts[day] += 1
            entity_daily[entity][day] += 1
            if rr >= 9:   daily_crit[day]   += 1
            elif rr >= 8: daily_high[day]   += 1
            elif rr >= 5: daily_medium[day] += 1
            else:         daily_low[day]    += 1

        if status_int in BACKLOG_STATUSES:   backlog_count   += 1
        if status_int in FALSE_POS_STATUSES: false_pos_count += 1
        if status_int in TRUE_POS_STATUSES:  true_pos_count  += 1

       
        
        host = (
            alarm.get("impactedHostName") or alarm.get("hostName")
            or alarm.get("sourceHostName") or alarm.get("destinationHostName")
            or alarm.get("impactedHost")   or alarm.get("hostImpacted") or alarm.get("commonEventHost") or ""
        )

        sev_label = "critical" if rr >= 9 else "high" if rr >= 8 else "medium" if rr >= 5 else "low"

        alarm_data = {
            "alarmId": alarm.get("alarmId"),
            "alarmRuleName": rule_name,
            "alarmStatus": status_lbl,
            "entityName": entity,
            "hostImpacted": host,
            "classification": classification,
            "riskRating": rr,
            "severityLabel": sev_label,
            "dateInserted": alarm.get("dateInserted"),
            "isIntrusion": is_pillar_intrusion
        }
                    
            #intrusion_count += 1

        # Liste complète pour la page Events
        alarm_list.append(alarm_data)

        # Backlog critique (Top 20)
        if sev_label in ["critical", "high"] and status_int in BACKLOG_STATUSES:
            if sev_label == "critical": critical_count += 1
            else: high_count += 1
            if len(critical_list) < 20:
                critical_list.append(alarm_data)


    fp_rate = round(false_pos_count / total * 100, 1) if total else 0
    tp_rate = round(true_pos_count  / total * 100, 1) if total else 0

    case_priority = Counter()
    case_status   = Counter()
    for case in cases:
        p = str(case.get("priority", "?"))
        case_priority[p] += 1
        s = case.get("status", {})
        s_name = s.get("name", "?") if isinstance(s, dict) else str(s)
        case_status[s_name] += 1

    sorted_days = sorted(daily_counts)
    # Ajoute ce print juste avant le "return" final de ta fonction Python
    print(f"DEBUG PYTHON - Total Intrusions dans metrics: {sum(1 for a in alarm_list if a['isIntrusion'])}")
    # --- DEBUT DE LA CORRECTION DES CASES ---
    # === BLOC DE TRAITEMENT ET DIAGNOSTIC DES CASES ===
    case_priority = Counter()
    case_status   = Counter()
    filtered_cases = []
    
    # Initialisation des compteurs dynamiques (KPIs)
    escalated_count = 0  # Dossiers N2/N3 (Priorités 1 et 2)
    resolved_count  = 0  # Volume global d'incidents traités terminés
    backlog_count   = 0  # Compteur global pour le Backlog
    
    # NOUVEAU : Compteurs pour la pertinence des alertes
    true_pos_count  = 0  # Vrais Positifs
    false_pos_count = 0  # Faux Positifs

    # Liste exhaustive des statuts marquant la fin du traitement d'un dossier
    STATUTS_TRAITES = [
        "closed", "completed", "resolved", "fermé", "clôturé", 
        "false positive", "dismissed", "rejected"
    ]
    
    # Sous-ensemble des statuts explicitement qualifiés de Faux Positifs
    STATUTS_FAUX_POSITIFS = ["false positive", "dismissed", "rejected"]

    day_from = date_from[:10]
    day_to   = date_to[:10]

    if cases:
        print("🔍 [DIAGNOSTIC SOC] Clés réelles d'un dossier :", list(cases[0].keys()))

    for case in cases:
        # ── CALCUL DU BACKLOG (EN TEMPS RÉEL — SANS FILTRE DE DATE) ──
        s_obj = case.get("status", {})
        s_name_raw = s_obj.get("name", "?") if isinstance(s_obj, dict) else str(s_obj)
        
        if s_name_raw.lower() not in STATUTS_TRAITES:
            backlog_count += 1
            
        # ── FILTRE DE DATE POUR LES STATISTIQUES DE LA PÉRIODE ──
        case_date_raw = (
            case.get("dateCreated") or 
            case.get("dateOpened") or 
            case.get("openedDate") or 
            case.get("date_created") or
            case.get("createdDate") or
            case.get("created_at") or ""
        )
        
        if case_date_raw:
            case_day = case_date_raw[:10]
            if not (day_from <= case_day <= day_to):
                continue

        filtered_cases.append(case)
        
        # Priorité (Escalade)
        p_val = case.get("priority")
        p_str = str(p_val if p_val is not None else "?")
        case_priority[p_str] += 1
        
        if p_val in [1, 2, "1", "2"]:
            escalated_count += 1
            
        # Statut 
        case_status[s_name_raw] += 1
        status_clean = s_name_raw.lower()
        
        # Qualification des dossiers traités sur la période
        if status_clean in STATUTS_TRAITES:
            resolved_count += 1
            if status_clean in STATUTS_FAUX_POSITIFS:
                false_pos_count += 1
            else:
                true_pos_count += 1
        
    # Calcul mathématique du Taux d'Escalade
    total_cases_period = len(filtered_cases)
    if total_cases_period > 0:
        escalation_rate = round((escalated_count / total_cases_period) * 100, 1)
    else:
        escalation_rate = 0.0

    # NOUVEAU : Calcul des taux de VP et FP sur le volume traité
    if resolved_count > 0:
        true_positive_rate  = round((true_pos_count / resolved_count) * 100, 1)
        false_positive_rate = round((false_pos_count / resolved_count) * 100, 1)
    else:
        true_positive_rate  = 0.0
        false_positive_rate = 0.0
    # === FIN DU BLOC ===

    return {
        # KPIs
        "total_alarms":        total,
        "critical_alarms":     critical_count,   # backlog uniquement (bannière + table)
        "high_alarms":         high_count,        # backlog uniquement
        "backlog":             backlog_count,
        "false_positive_rate": fp_rate,
        "true_positive_rate":  tp_rate,
        
        # --- SECTION INTRUSION (SÉPARÉE) ---
        "intrusion_attempts":  intrusion_count,
        "int_crit":            int_crit,          # NOUVEAU : RR9 spécifique intrusion
        "int_high":            int_high,          # NOUVEAU : RR8 spécifique intrusion
        "intrusion_details":   intrusion_details,
        
        # --- SECTION ALERTES NORMALES (SÉPARÉE) ---
        "severity_critical":   sev_critical,      # RR9 (Exclut les intrusions)
        "severity_high":       sev_high,          # RR8 (Exclut les intrusions)
        "severity_medium":     sev_medium,        # RR5-7
        "severity_low":        sev_low,           # RR<5
        
        # Distributions
        "by_status":     dict(status_counts.most_common()),
        "top_entities":  dict(entity_counts.most_common(10)),
        "top_rules":     dict(rule_counts.most_common(10)),
        "classifications": dict(classif_counts.most_common()),
        
        # Séries temporelles
        "daily_labels": sorted_days,
        "daily_counts": [daily_counts[d] for d in sorted_days],
        "daily_by_severity": {
            "Critical": [daily_crit.get(d, 0)   for d in sorted_days],
            "High":     [daily_high.get(d, 0)    for d in sorted_days],
            "Medium":   [daily_medium.get(d, 0)  for d in sorted_days],
            "Low":      [daily_low.get(d, 0)      for d in sorted_days],
        },
        "daily_by_entity": {
            entity: [entity_daily[entity].get(d, 0) for d in sorted_days]
            for entity, _ in entity_counts.most_common(5)
        },
        
        # Tableaux et Listes
        "critical_list": critical_list,
        "alarm_list":    alarm_list,
        
        # Cases (LogRhythm)
        "total_cases":        len(filtered_cases),
        "cases_by_priority":  dict(case_priority),
        "cases_by_status":    dict(case_status),
        "cases_list":         filtered_cases,

        "escalated_cases":     escalated_count,
        "escalation_rate":     escalation_rate,
        "resolved_cases":     resolved_count,
        "backlog_cases":      backlog_count,

        # Les deux nouvelles métriques jointes
        "true_positive_rate":  true_positive_rate,
        "false_positive_rate": false_positive_rate,

        # Métadonnées
        "date_from":    date_from,
        "date_to":      date_to,
    }

# ── API live ──────────────────────────────────────────────────────────────────
def compute_metrics(date_from: str, date_to: str) -> dict:
    """Calcule les métriques en appelant l'API LogRhythm."""
    alarms = fetch_alarms(date_from, date_to)
    if MONITORED_ENTITIES:
        alarms = [a for a in alarms if a.get("entityName") in MONITORED_ENTITIES]
    cases  = fetch_cases(date_from, date_to)
    result = _compute_from_alarms(alarms, date_from, date_to, cases)
    result["last_updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return result

# ── Mode local (fichier JSON exporté) ────────────────────────────────────────
def compute_metrics_from_file(filepath: str) -> tuple[dict, dict]:
    """
    Charge un fichier JSON exporté par export_alarms.py.
    Retourne (metrics_dict, drilldown_index {alarm_id: drilldown_data}).
    """
    with open(filepath, encoding="utf-8") as f:
        export = json.load(f)

    date_from  = export.get("date_from", "")
    date_to    = export.get("date_to",   "")
    items      = export.get("alarms", [])

    alarms_raw = [item["alarm"]                       for item in items]
    events_map = {item["alarm"].get("alarmId"): item.get("events", []) for item in items}

    result = _compute_from_alarms(alarms_raw, date_from, date_to)
    result["last_updated"] = export.get("exported_at", "")
    result["local_mode"]   = True
    result["local_file"]   = os.path.basename(filepath)

    drilldown_index = {
        alarm_id: _extract_info_from_events(events)
        for alarm_id, events in events_map.items()
    }

    return result, drilldown_index


#-----------------------
