"""
Authentification LogRhythm et client HTTP bas niveau.
Gère le token Bearer avec cache, et expose _get() pour les appels API.
"""

import os
import json
import base64
import requests
import urllib3
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Configuration (chargée depuis .env) ──────────────────────────────────────
BASE_URL        = os.getenv("LR_BASE_URL",       "https://172.20.200.4:8501")
CLIENT_ID       = os.getenv("LR_CLIENT_ID",       "")
CLIENT_SECRET   = os.getenv("LR_CLIENT_SECRET",   "")
_FALLBACK_TOKEN = os.getenv("LR_FALLBACK_TOKEN",   "")

_token_cache: dict = {"token": None, "exp": 0}

def _get_token() -> str:
    now = datetime.now(timezone.utc).timestamp()
    if _token_cache["token"] and _token_cache["exp"] - now > 60:
        return _token_cache["token"]
    try:
        resp = requests.post(
            f"{BASE_URL}/lr-auth-api/tokens",
            json={"clientId": CLIENT_ID, "clientSecret": CLIENT_SECRET},
            headers={"content-type": "application/json"},
            verify=False,
            timeout=10,
        )
        if resp.status_code in (200, 201):
            data  = resp.json()
            token = data.get("bearerToken") or data.get("token") or data.get("access_token")
            if token:
                try:
                    pb64 = token.split(".")[1]
                    pb64 += "=" * (-len(pb64) % 4)
                    exp  = json.loads(base64.b64decode(pb64)).get("exp", now + 3600)
                except Exception:
                    exp = now + 3600
                _token_cache.update({"token": token, "exp": exp})
                return token
    except Exception:
        pass
    _token_cache.update({"token": _FALLBACK_TOKEN, "exp": 1775147830})
    return _FALLBACK_TOKEN


def _headers() -> dict:
    return {"accept": "application/json", "authorization": f"Bearer {_get_token()}"}

def _get(path: str, params: dict = None, timeout: int = 15):
    """Effectue un GET authentifié sur l'API LogRhythm. Retourne le JSON ou None."""
    try:
        resp = requests.get(
            f"{BASE_URL}{path}",
            params=params,
            headers=_headers(),
            verify=False,
            timeout=timeout,
        )
        return resp.json() if resp.status_code == 200 else None
    except Exception:
        return None
