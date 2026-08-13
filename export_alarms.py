"""
export_alarms.py — Export des alarmes + events depuis LogRhythm
Exécuter depuis le réseau (VPN requis).
Résultat : SirDashboard/data/alarms_export_YYYYMMDD_HHMM.json
"""

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
import logrhythm

OUTPUT_DIR           = os.path.join(os.path.dirname(__file__), "data")
BATCH_SIZE           = 500    # alarmes par page (max conseillé LogRhythm)
DELAY_BETWEEN_CALLS  = 0.2   # secondes entre chaque appel /events


# ── Helpers ───────────────────────────────────────────────────────────────────
def parse_date(s: str) -> datetime:
    """Accepte DD/MM/YYYY ou YYYY-MM-DD."""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError


def fetch_all_alarms(date_from: str, date_to: str, limit: int | None) -> list:
    """
    Récupère les alarmes par pages de BATCH_SIZE jusqu'à :
      - avoir tout récupéré (limit=None), ou
      - avoir atteint `limit` alarmes.
    """
    collected = []
    offset    = 0

    while True:
        remaining = (limit - len(collected)) if limit else BATCH_SIZE
        page_size = min(BATCH_SIZE, remaining)

        data = logrhythm._get(
            "/lr-alarm-api/alarms",
            {
                "count":         page_size,
                "offset":        offset,
                "orderby":       "DateInserted",
                "dir":           "descending",
                "dateInserted":  date_from,
            },
        )

        if not data:
            break

        page = data.get("alarmsSearchDetails", [])
        # Filtrer strictement par date_to
        page = [a for a in page if a.get("dateInserted", "") <= date_to]

        if not page:
            break

        collected.extend(page)
        print(f"  Page offset={offset} → {len(page)} alarme(s) récupérée(s)  "
              f"(total : {len(collected)})")

        # Stop si on a atteint la limite ou si la page est incomplète (dernière page)
        if (limit and len(collected) >= limit) or len(page) < page_size:
            break

        offset += page_size
        time.sleep(0.1)

    return collected[:limit] if limit else collected


# ── Menu interactif ───────────────────────────────────────────────────────────
print("=" * 55)
print("   Export alarmes LogRhythm")
print("=" * 55)

# -- Période --
print("\nPériode :")
print("  [1] 7 derniers jours")
print("  [2] 30 derniers jours")
print("  [3] 90 derniers jours")
print("  [4] Dates personnalisées")

choix_periode = input("\nChoix [1/2/3/4] (défaut=2) : ").strip() or "2"

now = datetime.now(timezone.utc)

if choix_periode == "1":
    date_from_dt = now - timedelta(days=7)
    date_to_dt   = now
elif choix_periode == "3":
    date_from_dt = now - timedelta(days=90)
    date_to_dt   = now
elif choix_periode == "4":
    while True:
        try:
            d1 = input("  Date début (DD/MM/YYYY ou YYYY-MM-DD) : ")
            date_from_dt = parse_date(d1)
            d2 = input("  Date fin   (DD/MM/YYYY ou YYYY-MM-DD) : ")
            date_to_dt   = parse_date(d2)
            if date_from_dt >= date_to_dt:
                print("  La date de début doit être avant la date de fin.")
                continue
            break
        except ValueError:
            print("  Format invalide, réessayez (ex: 01/02/2026).")
else:  # défaut = 30 jours
    date_from_dt = now - timedelta(days=30)
    date_to_dt   = now

date_from = date_from_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
date_to   = date_to_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

# -- Nombre d'alarmes --
print("\nNombre d'alarmes :")
print("  [Entrée] Toutes les alarmes de la période (défaut)")
print("  [N]      Entrer un nombre (ex: 500)")

choix_limite = input("\nNombre max (ou Entrée pour tout) : ").strip()
if choix_limite:
    try:
        limit = int(choix_limite)
        if limit <= 0:
            raise ValueError
    except ValueError:
        print("Nombre invalide, récupération de toutes les alarmes.")
        limit = None
else:
    limit = None

# -- Récap --
print(f"\nPériode  : {date_from}  →  {date_to}")
print(f"Limite   : {limit if limit else 'Toutes'}")
print("\nCollecte en cours...\n")

# ── 1. Récupération des alarmes (avec pagination) ─────────────────────────────
alarms = fetch_all_alarms(date_from, date_to, limit)

print(f"\nTotal alarmes collectées : {len(alarms)}")

if not alarms:
    print("Aucune alarme trouvée. Vérifiez la connexion VPN / token.")
    sys.exit(1)

# ── 2. Récupération des events pour chaque alarme ─────────────────────────────
print("\nRécupération des events...\n")
enriched = []
errors   = []

for i, alarm in enumerate(alarms, 1):
    alarm_id = alarm.get("alarmId")
    rule     = alarm.get("alarmRuleName", "?")
    print(f"  [{i}/{len(alarms)}] #{alarm_id} — {rule[:60]}", end="", flush=True)

    events_data = logrhythm._get(f"/lr-alarm-api/alarms/{alarm_id}/events")

    if events_data:
        raw_events = (
            events_data.get("alarmEventsDetails")
            or events_data.get("events")
            or events_data.get("alarmEvents")
            or (events_data if isinstance(events_data, list) else [])
        )
        print(f"  → {len(raw_events)} event(s)")
    else:
        raw_events = []
        errors.append(alarm_id)
        print("  → erreur API")

    enriched.append({
        "alarm":  alarm,
        "events": raw_events,
    })

    time.sleep(DELAY_BETWEEN_CALLS)

# ── 3. Sauvegarde JSON ────────────────────────────────────────────────────────
os.makedirs(OUTPUT_DIR, exist_ok=True)

filename = f"alarms_export_{now.strftime('%Y%m%d_%H%M')}.json"
filepath = os.path.join(OUTPUT_DIR, filename)

output = {
    "exported_at":  now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "date_from":    date_from,
    "date_to":      date_to,
    "total_alarms": len(enriched),
    "limit_applied": limit,
    "alarms":       enriched,
}

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

# ── Résumé ────────────────────────────────────────────────────────────────────
# print(f"\n{'=' * 55}")
print(f"Export termine !")
print(f"Fichier  : {filepath}")
print(f"Alarmes  : {len(enriched)}")
if errors:
    print(f"Erreurs: {len(errors)} alarme(s) sans events")
    print(f"IDs : {errors}")
print(f"{'=' * 55}")
