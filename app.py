"""
SirDashboard — Serveur Flask SOC Dashboard
Lance avec : python app.py
Accès       : http://localhost:5000
"""
import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)

from flask import Flask, make_response, jsonify, render_template, request
from flask_login import LoginManager, login_required, current_user
from werkzeug.middleware.proxy_fix import ProxyFix
from collections import Counter

# Modules personnalisés pour la BDD et les Routes (Auth + Users)
from database import db, init_db, User
from routes.auth import auth_bp
from routes.users import users_bp

import logrhythm
from logrhythm.client import fetch_drilldown, get_full_forensic_data, fetch_case_by_id, fetch_cases

app = Flask(__name__)

# ── 2. CONFIGURATION DE MARIADB & SESSIONS ─────────────────────────────────────
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "soc_dashboard")

app.config['SECRET_KEY'] = os.getenv("SECRET_KEY", "cle_secrete_soc_2026")
#app.config['SQLALCHEMY_DATABASE_URI'] = f"mysql+pymysql://:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
app.config["SQLALCHEMY_DATABASE_URI"] = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'false').lower() == 'true'
# Apache (reverse proxy) transmet X-Forwarded-* — nécessaire pour HTTPS et les redirections
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# Initialisation de la BDD avec l'application Flask
db.init_app(app)

# Initialisation de Flask-Login
login_manager = LoginManager(app)
login_manager.login_view = 'auth.login'
login_manager.login_message = "Accès restreint. Veuillez vous connecter."

#@login_manager.user_loader
#def load_user(user_id):
#    return User.query.get(int(user_id))
# NOUVELLE SYNTAXE (SQLAlchemy 2.0)
@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

# ── 3. ENREGISTREMENT DES BLUEPRINTS (ROUTES AUTH & CRUD) ───────────────────────
app.register_blueprint(auth_bp)
app.register_blueprint(users_bp)

# ── 4. CONFIGURATION LOGRHYTHM & CACHE ──────────────────────────────────────────
CACHE_TTL = int(os.getenv("CACHE_TTL", 300))

# Mode local (fichier JSON exporté)
_LOCAL_FILE = os.getenv("LOCAL_DATA_FILE", "")
_local_metrics    = None   # métriques pré-calculées depuis le fichier
_local_drilldown  = {}     # {alarm_id: drilldown_dict}

if _LOCAL_FILE:
    _fp = _LOCAL_FILE if os.path.isabs(_LOCAL_FILE) else os.path.join(
        os.path.dirname(__file__), "data", _LOCAL_FILE
    )
    if os.path.exists(_fp):
        print(f"  [MODE LOCAL] Chargement de : {_fp}")
        _local_metrics, _local_drilldown = logrhythm.compute_metrics_from_file(_fp)
        print(f"  [MODE LOCAL] {_local_metrics['total_alarms']} alarmes chargées.")
    else:
        print(f"  [AVERTISSEMENT] Fichier introuvable : {_fp}")

# Cache en mémoire (mode API)
_cache: dict = {}

def _compute(date_from: str, date_to: str, force: bool = False) -> dict:
    """Calcule ou retourne depuis le cache les métriques pour une plage donnée."""
    if _local_metrics is not None:
        return _local_metrics   # mode local : toujours le même dataset
    key = (date_from, date_to)
    now = datetime.now(timezone.utc).timestamp()
    if not force and key in _cache and (now - _cache[key]["ts"]) < CACHE_TTL:
        return _cache[key]["data"]
    data = logrhythm.compute_metrics(date_from, date_to)
    _cache[key] = {"data": data, "ts": now}
    return data

def _range_from_days(days: int):
    utc = datetime.now(timezone.utc)
    return (
        (utc - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z"),
        utc.strftime("%Y-%m-%dT23:59:59Z"),
    )

# ── 5. ROUTES DU DASHBOARD (SÉCURISÉES AVEC @login_required) ───────────────────

@app.route("/")
@login_required
def index():
    return render_template("index.html", active_tab="dashboard", user=current_user)

@app.route("/events")
@login_required
def events():
    return render_template("events.html", active_tab="events", user=current_user)

@app.route("/cases/list")
@login_required
def cases_list_view():
    days = int(request.args.get("days", 30))
    date_from, date_to = _range_from_days(days)
    all_cases = logrhythm.client.fetch_cases(date_from, date_to)
    return render_template("cases_list.html", cases=all_cases, user=current_user)

@app.route("/case/<string:case_id>")
@login_required
def case_detail(case_id):
    try:
        case_data = fetch_case_by_id(case_id)
    except Exception as e:
        print(f"❌ Erreur lors de l'appel API LogRhythm pour le case {case_id} : {e}")
        return "Erreur lors de la communication avec le serveur LogRhythm.", 500

    if not case_data:
        return f"Le Case avec l'ID {case_id} n'existe pas ou n'est plus disponible dans LogRhythm.", 404

    real_case = {
        "id": case_data.get("id"),
        "number": case_data.get("number", "—"),
        "title": case_data.get("name", "Sans titre"),
        "summary": case_data.get("summary", "Aucun résumé disponible"),
        "owner": case_data.get("owner", {}).get("name", "Non assigné"),
        "status": case_data.get("status", {}).get("name", "Inconnu"),
        "priority": case_data.get("priority", "—"),
        "entity": case_data.get("entity", {}).get("name", "Global Entity"),
        "date_created": case_data.get("dateCreated"),
        "date_updated": case_data.get("dateUpdated"),
        "resolution": case_data.get("resolution", ""),
        "collaborators": case_data.get("collaborators", [])
    }
    
    return render_template("case_detail.html", case=real_case, user=current_user)

# ── 6. ROUTES API LOGRHYTHM (SÉCURISÉES AVEC @login_required) ───────────────────

@app.route("/api/metrics")
@login_required
def api_metrics():
    force     = request.args.get("force", "false").lower() == "true"
    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")

    if date_from and date_to:
        if "T" not in date_from:
            date_from += "T00:00:00Z"
        if "T" not in date_to:
            date_to += "T23:59:59Z"
    else:
        days = int(request.args.get("days", 30))
        date_from, date_to = _range_from_days(days)
    
    metrics_data = _compute(date_from, date_to, force)
    if not isinstance(metrics_data, dict):
        metrics_data = {}

    if "cases_list" not in metrics_data:
        try:
            metrics_data["cases_list"] = logrhythm.client.fetch_cases(date_from, date_to)
        except Exception as e:
            print(f"Erreur fetch_cases secours : {e}")
            metrics_data["cases_list"] = []

    return jsonify(metrics_data)

@app.route("/api/drilldown/<int:alarm_id>")
@login_required
def api_drilldown(alarm_id):
    if _local_drilldown:
        return jsonify(_local_drilldown.get(alarm_id, {}))
    return jsonify(logrhythm.fetch_drilldown(alarm_id))

@app.route("/api/refresh")
@login_required
def api_refresh():
    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")
    if not (date_from and date_to):
        days = int(request.args.get("days", 30))
        date_from, date_to = _range_from_days(days)
    return jsonify(_compute(date_from, date_to, force=True))

@app.route("/api/alarms")
@login_required
def api_alarms():
    force     = request.args.get("force", "false").lower() == "true"
    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")
    severity  = request.args.get("severity", "all").lower()

    if date_from and date_to:
        if "T" not in date_from:
            date_from += "T00:00:00Z"
        if "T" not in date_to:
            date_to += "T23:59:59Z"
    else:
        days = int(request.args.get("days", 30))
        date_from, date_to = _range_from_days(days)

    data       = _compute(date_from, date_to, force)
    alarm_list = data.get("alarm_list", [])

    if severity == "intrusion":
        alarm_list = [a for a in alarm_list if a.get("isIntrusion")]
    elif severity != "all":
        alarm_list = [a for a in alarm_list if a.get("severityLabel") == severity]

    return jsonify({
        "alarms":       alarm_list,
        "total":        len(alarm_list),
        "severity":     severity,
        "date_from":    date_from,
        "date_to":      date_to,
        "last_updated": data.get("last_updated", ""),
    })

@app.route("/api/stats/full-forensic")
@login_required
def api_full_forensic():
    days = request.args.get("days")
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")

    if date_from and date_to:
        if "T" not in date_from: date_from += "T00:00:00Z"
        if "T" not in date_to: date_to += "T23:59:59Z"
        data = _compute(date_from, date_to)
    else:
        nb_days = int(days) if days else 30
        data = _compute(*_range_from_days(nb_days))
    
    full_list = data.get("alarm_list", [])
    relevant_alarms = [
        a for a in full_list
        if a.get("isIntrusion") or a.get("severityLabel") in ["critical", "high"]
    ][:40]
    enriched_data = get_full_forensic_data(relevant_alarms)

    return jsonify({
        "base_stats": data,
        "forensic_details": enriched_data
    })

def _generate_graph_summaries(metrics: dict, forensic_data: list = None) -> dict:
    """
    Génère des synthèses textuelles détaillées en français lisible pour l'ensemble des graphiques du Dashboard.
    """
    summaries = {}

    # 1. Évolution Temporelle
    days = metrics.get("daily_labels", [])
    counts = metrics.get("daily_counts", [])
    total_alarms = metrics.get("total_alarms", 0)

    if days and counts and total_alarms > 0:
        max_count = max(counts)
        max_index = counts.index(max_count)
        peak_day = days[max_index]
        peak_day_fr = "/".join(reversed(peak_day.split("-"))) if "-" in peak_day else peak_day
        avg_daily = round(total_alarms / len(days), 1)

        summaries["evolution"] = (
            f"Sur une période de {len(days)} jour(s) analysé(s), un volume global de {total_alarms} alarme(s) "
            f"a été recensé, représentant une moyenne journalière de {avg_daily} alarme(s). "
            f"La journée du {peak_day_fr} a enregistré la plus forte concentration d'activité "
            f"avec un pic maximal de {max_count} alarme(s)."
        )
    else:
        summaries["evolution"] = "Aucune activité d'alarme significative enregistrée sur la période sélectionnée."

    # 2. Analyse Forensic (Top Sources, Hôtes Impactés, CVE & Typologies)
    if forensic_data:
        sources_counter = Counter(item["source"] for item in forensic_data if item.get("source") not in ["N/A", ""])
        hosts_counter   = Counter(item["impacted"] for item in forensic_data if item.get("impacted") not in ["N/A", ""])
        cve_counter     = Counter(item["cve"] for item in forensic_data if item.get("cve"))

        # Top Source
        top_source_str = "non identifiée"
        if sources_counter:
            src, src_c = sources_counter.most_common(1)[0]
            top_source_str = f"'{src}' ({src_c} attaque(s))"

        # Top Hôte
        top_host_str = "non spécifié"
        if hosts_counter:
            hst, hst_c = hosts_counter.most_common(1)[0]
            top_host_str = f"'{hst}' ({hst_c} alerte(s) reçue(s))"

        summaries["forensic"] = (
            f"L'analyse approfondie des artefacts révèle que la principale source d'origine des attaques est {top_source_str}. "
            f"L'équipement ou l'hôte le plus ciblé par ces événements est {top_host_str}."
        )

        # Vulnérabilités (CVE)
        if cve_counter:
            top_cve_list = [f"{cve} ({cnt})" for cve, cnt in cve_counter.most_common(3)]
            summaries["cve"] = (
                f"Des tentatives d'exploitation de vulnérabilités connues (CVE) ont été identifiées. "
                f"Les principales CVE détectées sont : {', '.join(top_cve_list)}."
            )
        else:
            summaries["cve"] = "Aucune signature de vulnérabilité connue (CVE) n'a été associée directement aux alarmes analysées."
    else:
        summaries["forensic"] = "Données forensic approfondies non disponibles pour cette période."
        summaries["cve"] = "Aucune donnée de vulnérabilité CVE identifiée."

    # 3. Répartition des Intrusions
    intrusions = metrics.get("intrusion_attempts", 0)
    details = metrics.get("intrusion_details", {})

    if intrusions > 0:
        labels_map = {
            "config_mod": "modifications de configuration",
            "malware": "infection par malware/ransomware",
            "brute_force": "attaques par force brute",
            "web_attack": "attaques applicatives web"
        }
        top_cat_key = max(details, key=details.get) if details else None
        top_cat_count = details.get(top_cat_key, 0) if top_cat_key else 0
        top_cat_name = labels_map.get(top_cat_key, top_cat_key)
        pct = round((top_cat_count / intrusions) * 100, 1) if intrusions else 0

        summaries["intrusions"] = (
            f"Un total de {intrusions} tentative(s) d'intrusion a été bloqué ou analysé. "
            f"La menace prédominante reste les {top_cat_name} ({top_cat_count} occurrence(s), soit {pct}% des intrusions). "
            f"Bilan détaillé : {details.get('brute_force', 0)} tentative(s) Brute Force, "
            f"{details.get('web_attack', 0)} attaque(s) Web, et {details.get('malware', 0)} alerte(s) Malware."
        )
    else:
        summaries["intrusions"] = "Aucune tentative d'intrusion critique détectée sur la période."

    # 4. Statuts & Qualification SOC
    total_cases = metrics.get("total_cases", 0)
    resolved = metrics.get("resolved_cases", 0)
    tp_rate = metrics.get("true_positive_rate", 0)
    fp_rate = metrics.get("false_positive_rate", 0)

    summaries["status"] = (
        f"L'équipe SOC a ouvert {total_cases} dossier(s) d'investigation (cases) sur la période, dont {resolved} ont été résolus. "
        f"La qualification opérationnelle affiche un taux de pertinence de {tp_rate}% de vrais positifs (incidents confirmés) "
        f"pour un taux de bruit de {fp_rate}% de faux positifs."
    )

    return summaries

@app.route("/api/reports/download-pdf")
@login_required
def download_pdf_report():
    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")

    if date_from and date_to:
        if "T" not in date_from: date_from += "T00:00:00Z"
        if "T" not in date_to:   date_to   += "T23:59:59Z"
    else:
        days = int(request.args.get("days", 30))
        date_from, date_to = _range_from_days(days)

    metrics = _compute(date_from, date_to, force=False)
    if not isinstance(metrics, dict):
        metrics = {}

    # Extraction des données forensic pour l'analyse des graphiques
    alarm_list = metrics.get("alarm_list", [])
    forensic_data = get_full_forensic_data(alarm_list[:50]) # Analyse du top 50 pour la rapidité

    # Génération des résumés textuels
    graph_summaries = _generate_graph_summaries(metrics, forensic_data)

    top_rules_raw = metrics.get("top_rules", {})
    top_rules = [{"name": name, "count": count} for name, count in top_rules_raw.items()]

    report_context = {
        "generated_at": datetime.now().strftime("%d/%m/%Y à %H:%M"),
        "date_from": date_from,
        "date_to": date_to,
        "total_alarms": metrics.get("total_alarms", 0),
        "sev_critical": metrics.get("severity_critical", 0),
        "sev_high":     metrics.get("severity_high", 0),
        "sev_medium":   metrics.get("severity_medium", 0),
        "sev_low":      metrics.get("severity_low", 0),
        "intrusion_attempts": metrics.get("intrusion_attempts", 0),
        "int_crit":           metrics.get("int_crit", 0),
        "int_high":           metrics.get("int_high", 0),
        "intrusion_details":  metrics.get("intrusion_details", {}),
        "total_cases":          metrics.get("total_cases", 0),
        "resolved_cases":       metrics.get("resolved_cases", 0),
        "true_positive_rate":   metrics.get("true_positive_rate", 0),
        "false_positive_rate":  metrics.get("false_positive_rate", 0),
        "top_rules":        top_rules,
        "critical_list":    metrics.get("critical_list", []),
        "summaries":        graph_summaries
    }

    rendered_html = render_template("report_pdf.html", data=report_context, user=current_user)
    try:
        from weasyprint import HTML
        pdf = HTML(string=rendered_html).write_pdf()
    except OSError:
        return "WeasyPrint nécessite les bibliothèques Pango/GTK (disponibles sur le serveur Ubuntu). L'export PDF n'est pas disponible sur cet environnement.", 503

    response = make_response(pdf)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f'attachment; filename=Rapport_SOC_{datetime.now().strftime("%Y%m%d_%H%M")}.pdf'
    
    return response
    
@app.route("/api/test-debug")
@login_required
def test_debug():
    data = _compute(*_range_from_days(1))
    alarms = data.get("alarm_list", [])
    if not alarms: return "Pas d'alarmes"
    
    first_alarm = alarms[0]
    details = logrhythm.fetch_drilldown(first_alarm.get('alarmId'))
    
    return jsonify({
        "champs_alarme_simple": list(first_alarm.keys()),
        "contenu_alarme_simple": first_alarm,
        "champs_drilldown": list(details.keys()) if details else "Erreur drilldown",
        "contenu_drilldown": details
    })

# ── 7. DEMARRAGE SERVEUR & BDD ──────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 50)
    print("  SirDashboard — SOC Dashboard LogRhythm")
    print("  http://localhost:5000")
    print("=" * 50)
    
    # 1. Crée les tables MariaDB et le SuperAdmin au premier lancement
    init_db(app)
    
    # 2. Lancement du serveur Web
    port = int(os.getenv("FLASK_PORT", 5000))
    app.run(debug=False, host="0.0.0.0", port=port)