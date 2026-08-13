"""Point d'entrée WSGI pour Gunicorn (production Ubuntu / Apache)."""
from app import app
from database import init_db

init_db(app)
