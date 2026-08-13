"""
Référentiel statique LogRhythm — classifications, statuts, seuils.
Aucune logique ici : uniquement des données de référence.
"""

# ── Statuts alarme (entier → texte) ──────────────────────────────────────────
ALARM_STATUS = {
    0: "New",
    1: "Open",
    2: "Open: Working",
    3: "Open: Escalated",
    4: "Closed: False Alarm",
    5: "Closed: Resolved",
    6: "Closed: Unresolved",
    7: "Closed: Reported",
    8: "Closed: Monitor",
}

# Groupes de statuts pour les KPIs
BACKLOG_STATUSES    = {0, 1, 2, 3}   # alertes non traitées
FALSE_POS_STATUSES  = {4}            # faux positifs
TRUE_POS_STATUSES   = {5, 7}         # vraies alertes (résolu / rapporté)

# ── Référentiel des 14 classifications LogRhythm (v7.23.0) ───────────────────
# Format : { "Classification": risk_rating }
LR_CLASSIFICATIONS = {
    # ── Classifications standard LR v7.23.0 ──────────────────────────────────
    "Compromise":               9,  # Compromission confirmée — RR critique
    "Malware":                  9,  # Malware actif (trojan, worm, etc.) — RR critique
    "Attack":                   8,  # Attaque présumée réussie — RR élevé
    "Denial of Service":        8,  # DoS/DDoS présumé réussi — RR élevé
    "Suspicious":               6,  # Activité suspecte non confirmée — RR moyen-haut
    "Reconnaissance":           4,  # Scan / enumération réseau — RR faible
    "Misuse":                   5,  # Mauvais usage (P2P, webmail, etc.) — RR moyen
    "Activity":                 0,  # Activité générale sans caractère malveillant
    "Failed Attack":            0,  # Attaque bloquée par les mesures de prévention
    "Failed Denial of Service": 0,  # DoS bloqué
    "Failed Malware":           0,  # Malware bloqué
    "Failed Suspicious":        0,  # Activité suspecte bloquée
    "Failed Activity":          0,  # Activité générale bloquée
    "Other Security":           0,  # Activité non classifiable
    # # ── Classifications spécifiques à cet environnement ──────────────────────
    # "Brute Force":              8,  # Attaque par force brute — RR élevé
    # "Cryptomining":             8,  # Minage illégitime — RR élevé
    # "Web shell":                9,  # Shell web déposé — RR critique
    # "Command and control":      9,  # Communication C2 — RR critique
}

# Seuils de sévérité (Risk Rating — référentiel v7.23.0)
RR_CRITICAL = 9   # Compromise, Malware → intervention immédiate
RR_HIGH     = 8   # Attack, Denial of Service → escalade prioritaire

# Entités surveillées — seules les alarmes appartenant à ces entités sont traitées.
# Laisser vide (set()) pour traiter toutes les entités.
MONITORED_ENTITIES: set = {
    "AIR_CI",
    "AIR_CI DC",
    "Cluster switch AIR-CI",
    "Cluster_FW AIR-CI",
    "Linux server",
    "SW_Access AIR-CI",
    "WIFI Controleur AIR-CI",
    
}
#SIR CONTROLEURS",
#    "SIR",

# Mots-clés cherchés dans alarmRuleName (lowercase) pour détecter une tentative d'intrusion
INTRUSION_KEYWORDS = [
    "brute",                # Attaque par force brute
    "multiple failed",      # Tentatives multiples (logon, auth)
    "failed",               # Tentative échouée (auth, logon, attack)
    "auth failure",         # Échec d'authentification
    # "lateral",              # Mouvement latéral
    # "malware",              # Malware détecté
    # "ransomware",           # Ransomware
    # "command and control",  # Communication C2
    # "web shell",            # Shell web déposé
    # "cryptomining",         # Minage illégitime
    # "privilege escal",      # Élévation de privilèges
    # "unauthorized access",  # Accès non autorisé
    #"config",
    "malware",
    "web"
    
]

# ── Mots-clés fallback (quand le champ 'classification' est absent de l'API) ─

CLASSIFICATION_KEYWORDS = {
    "Compromise": [
        "compromise", "privilege escalat", "unauthorized access",
        "takeover", "control flow", "config modif", "apt:",
    ],
    "Attack": [
        "buffer overflow", "sql injection", "session hijack", "exploit",
        "brute force", "password spray", "auth fail", "logon fail",
        "forceful brows", "injection", "rce", "cve-", "shellcode",
    ],
    "Denial of Service": [
        "denial of service", "dos", "ddos", "synflood", "ping of death",
        "win nuke", "teardrop", "resource starvation", "spam flood",
    ],
    "Malware": [
        "malware", "ransomware", "trojan", "backdoor",
        "worm", "virus", "spyware", "rootkit",
    ],
    "Suspicious": [
        "suspicious", "suspect", "anomal", "default account",
        "multiple fail", "unusual", "abnormal payload",
    ],
    "Reconnaissance": [
        "scan", "recon", "probe", "enumeration", "discovery",
        "sweep", "nmap", "port scan", "web crawl", "crawling",
    ],
    "Misuse": [
        "webmail", "p2p", "peer-to-peer", "pornograph",
        "policy violation", "misuse", "unauthorized program",
    ],
    
    "Failed Attack":            ["failed attack", "blocked attack", "dropped attack"],
    "Failed Denial of Service": ["failed dos", "blocked dos", "prevented dos", "prevented ddos"],
    "Failed Malware":           ["failed malware", "blocked malware", "blocked trojan", "blocked worm"],
    "Failed Suspicious":        ["failed suspicious", "blocked suspicious", "blocked hotmail"],
    "Failed Activity":          ["failed activity", "drop p2p", "ftp refused"],

}

# Les 4 piliers demandés par le client
INTRUSION_CLASSIFICATIONS = ["Compromise", "Attack", "Malware", "Suspicious"]

# Mots-clés qui excluent une alarme de la catégorie "Intrusion" 
# (Même si la classification est Attack ou Suspicious)
EXCLUSION_KEYWORDS = [
    "denial of service", "dos", "ddos", "flood", 
    "misuse", "p2p", "policy violation", "scan", "reconnaissance"
]

