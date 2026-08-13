"""
Logique de classification des alarmes LogRhythm.
"""

from .constants import (
    LR_CLASSIFICATIONS, CLASSIFICATION_KEYWORDS, 
    RR_CRITICAL, RR_HIGH, INTRUSION_CLASSIFICATIONS, EXCLUSION_KEYWORDS
)

def classify_alarm(alarm: dict) -> tuple:
    """
    Retourne (classification: str, risk_rating: int, is_intrusion: bool).
    """
    native = alarm.get("classification", "")
    rule_name = alarm.get("alarmRuleName", "").lower()
    
    # 1. Déterminer la classification et le RR
    final_class = "Other Security"
    final_rr = 0

    if native:
        final_class = native
        final_rr = LR_CLASSIFICATIONS.get(native, 0)
    else:
        for classification, keywords in CLASSIFICATION_KEYWORDS.items():
            if any(kw in rule_name for kw in keywords):
                final_class = classification
                final_rr = LR_CLASSIFICATIONS.get(classification, 0)
                break

    # 2. LOGIQUE CLIENT : Est-ce une tentative d'intrusion ?
    # Règle : Dans les 4 piliers ET ne contient pas de mot-clé d'exclusion
    is_candidate = final_class in INTRUSION_CLASSIFICATIONS
    has_exclusion = any(kw in rule_name for kw in EXCLUSION_KEYWORDS)
    
    is_intrusion = is_candidate and not has_exclusion

    return final_class, final_rr, is_intrusion

def get_severity(rr: int) -> str | None:
    """Retourne 'critical' (RR≥9), 'high' (RR≥8), ou None."""
    if rr >= RR_CRITICAL:
        return "critical"
    if rr >= RR_HIGH:
        return "high"
    return None
