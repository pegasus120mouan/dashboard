from flask import Blueprint, render_template, request, redirect, jsonify, flash, current_app
from flask_login import login_user, logout_user, login_required, current_user
from database import db, User, UserRole

auth_bp = Blueprint('auth', __name__)

# --- LOGIN & ME ---
@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect("/")

    if request.method == "POST":
        data = request.get_json() if request.is_json else request.form
        username = data.get("username")
        password = data.get("password")

        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            if request.is_json:
                return jsonify({"status": "success", "user": user.to_dict()})
            return redirect("/")

        if request.is_json:
            return jsonify({"status": "error", "message": "Identifiants invalides."}), 401
        flash("Identifiants invalides ou compte inexistant.", "danger")

    return render_template("login.html")

@auth_bp.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect("/login")

@auth_bp.route("/api/me")
@login_required
def me():
    return jsonify({
        "authenticated": True,
        "user": current_user.to_dict()
    })

# ══════════════════════════════════════════════════════════════════════════════
# GESTION DES UTILISATEURS (CRUD + HIÉRARCHIE DES RÔLES)
# ══════════════════════════════════════════════════════════════════════════════

def _role_of(user) -> str:
    if hasattr(user, "role_value"):
        return user.role_value
    role = getattr(user, "role", None)
    return role.value if hasattr(role, "value") else str(role or "Analyst")


@auth_bp.route("/users", methods=["GET"])
@login_required
def list_users():
    if _role_of(current_user) not in ("SuperAdmin", "Admin"):
        flash("Accès non autorisé.", "danger")
        return redirect("/")

    try:
        users = User.query.order_by(User.id.asc()).all()
    except Exception:
        current_app.logger.exception("Impossible de charger les utilisateurs")
        flash("Impossible de charger la liste des comptes. Vérifiez la connexion à la base.", "danger")
        users = []
    role_counts = {
        "total": len(users),
        "superadmin": sum(1 for u in users if _role_of(u) == "SuperAdmin"),
        "admin": sum(1 for u in users if _role_of(u) == "Admin"),
        "analyst": sum(1 for u in users if _role_of(u) == "Analyst"),
    }
    return render_template(
        "users.html",
        users=users,
        role_counts=role_counts,
        active_tab="users",
    )

@auth_bp.route("/users/create", methods=["POST"])
@login_required
def create_user():
    if _role_of(current_user) not in ("SuperAdmin", "Admin"):
        flash("Accès non autorisé.", "danger")
        return redirect("/")

    username = request.form.get("username", "").strip().lower()
    password = request.form.get("password")
    role_str = request.form.get("role")

    # Seuls Admin et Analyst peuvent être créés depuis le formulaire
    if role_str == "Admin":
        selected_role = UserRole.ADMIN
    elif role_str == "Analyst":
        selected_role = UserRole.ANALYST
    else:
        flash("Rôle sélectionné invalide.", "danger")
        return redirect("/users")

    if User.query.filter_by(username=username).first():
        flash("Un utilisateur avec cette adresse email existe déjà.", "danger")
        return redirect("/users")

    new_user = User(username=username, role=selected_role)
    new_user.set_password(password)
    
    db.session.add(new_user)
    db.session.commit()
    flash(f"Utilisateur {username} créé avec succès !", "success")
    return redirect("/users")

@auth_bp.route("/users/update/<int:user_id>", methods=["POST"])
@login_required
def update_user(user_id):
    if _role_of(current_user) not in ("SuperAdmin", "Admin"):
        flash("Accès non autorisé.", "danger")
        return redirect("/")

    target_user = User.query.get_or_404(user_id)

    # Règle : Un Admin ne peut pas modifier le compte d'un SuperAdmin
    if current_user.role == UserRole.ADMIN and target_user.role == UserRole.SUPERADMIN:
        flash("Un Administrateur ne peut pas modifier un SuperAdmin.", "danger")
        return redirect("/users")

    new_password = request.form.get("new_password")
    new_role_str = request.form.get("role")

    # Mise à jour du rôle (interdit de modifier le rôle du SuperAdmin)
    if target_user.role != UserRole.SUPERADMIN and new_role_str:
        if new_role_str == "Admin":
            target_user.role = UserRole.ADMIN
        elif new_role_str == "Analyst":
            target_user.role = UserRole.ANALYST

    # Modification du mot de passe
    if new_password and new_password.strip():
        target_user.set_password(new_password)

    db.session.commit()
    flash(f"Compte {target_user.username} mis à jour avec succès.", "success")
    return redirect("/users")

@auth_bp.route("/users/delete/<int:user_id>", methods=["POST"])
@login_required
def delete_user(user_id):
    if _role_of(current_user) not in ("SuperAdmin", "Admin"):
        flash("Accès non autorisé.", "danger")
        return redirect("/")

    target_user = User.query.get_or_404(user_id)

    # Règle 1 : Auto-suppression interdite
    if target_user.id == current_user.id:
        flash("Vous ne pouvez pas supprimer votre propre compte.", "danger")
        return redirect("/users")

    # Règle 2 : Un Admin ne peut pas supprimer un SuperAdmin
    if current_user.role == UserRole.ADMIN and target_user.role == UserRole.SUPERADMIN:
        flash("Un Administrateur ne peut pas supprimer un SuperAdmin.", "danger")
        return redirect("/users")
        
    db.session.delete(target_user)
    db.session.commit()
    flash("Utilisateur supprimé avec succès.", "success")
    return redirect("/users")