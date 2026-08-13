from functools import wraps
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from database import db, User, UserRole

users_bp = Blueprint('users', __name__)

def role_required(*allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not current_user.is_authenticated or current_user.role not in allowed_roles:
                return jsonify({"status": "error", "message": "Accès refusé. Privilèges insuffisants."}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

# READ (Liste) & CREATE
@users_bp.route("/api/users", methods=["GET", "POST"])
@login_required
@role_required(UserRole.SUPERADMIN, UserRole.ADMIN)
def manage_users():
    if request.method == "GET":
        users_list = User.query.all()
        return jsonify([u.to_dict() for u in users_list])

    if request.method == "POST":
        data = request.get_json()
        email = data.get("username")
        password = data.get("password")
        role_str = data.get("role", "Analyst")

        if not email or "@" not in email:
            return jsonify({"status": "error", "message": "Un email valide est requis."}), 400
        if not password or len(password) < 6:
            return jsonify({"status": "error", "message": "Mot de passe de 6 caractères minimum."}), 400
        if User.query.filter_by(username=email).first():
            return jsonify({"status": "error", "message": "Cet email existe déjà."}), 400
        if role_str == "SuperAdmin":
            return jsonify({"status": "error", "message": "Impossible de créer un autre SuperAdmin."}), 403

        try:
            role_enum = UserRole[role_str.upper()]
        except KeyError:
            role_enum = UserRole.ANALYST

        new_user = User(username=email, role=role_enum)
        new_user.set_password(password)
        db.session.add(new_user)
        db.session.commit()

        return jsonify({"status": "success", "user": new_user.to_dict()}), 201

# DELETE
@users_bp.route("/api/users/<int:user_id>", methods=["DELETE"])
@login_required
@role_required(UserRole.SUPERADMIN, UserRole.ADMIN)
def delete_user(user_id):
    target_user = User.query.get_or_404(user_id)
    
    if target_user.role == UserRole.SUPERADMIN:
        return jsonify({"status": "error", "message": "Impossible de supprimer le SuperAdmin."}), 403
    if target_user.id == current_user.id:
        return jsonify({"status": "error", "message": "Action impossible sur votre propre compte."}), 400

    db.session.delete(target_user)
    db.session.commit()
    return jsonify({"status": "success", "message": "Utilisateur supprimé."})