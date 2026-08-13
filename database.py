import os
import enum
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

class UserRole(enum.Enum):
    SUPERADMIN = "SuperAdmin"
    ADMIN = "Admin"
    ANALYST = "Analyst"

class User(UserMixin, db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(120), unique=True, nullable=False) # Email
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.Enum(UserRole), default=UserRole.ANALYST, nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "role": self.role.value
        }

def init_db(app):
    """Initialise MariaDB et injecte le SuperAdmin du .env si absent."""
    with app.app_context():
        db.create_all()
        
        sa_username = os.getenv("SUPERADMIN_USERNAME", "superadmin@soc.local")
        sa_password = os.getenv("SUPERADMIN_PASSWORD", "Admin2026!")
        
        existing_sa = User.query.filter_by(username=sa_username).first()
        if not existing_sa:
            superadmin = User(
                username=sa_username,
                role=UserRole.SUPERADMIN
            )
            superadmin.set_password(sa_password)
            db.session.add(superadmin)
            db.session.commit()
            print(f"  [BDD MariaDB] ✅ Compte SuperAdmin ({sa_username}) créé !")
        else:
            print(f"  [BDD MariaDB] ℹ️ Compte SuperAdmin ({sa_username}) déjà prêt.")