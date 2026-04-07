"""FastAPI dependencies (auth, DB access patterns)."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
import jwt as pyjwt
from bson import ObjectId

from app.core.database import db
from app.core.security import JWT_ALGORITHM, get_jwt_secret
from app.domain.permissions import ALL_PERMISSION_IDS, OPEN_ACCESS_ALL_PERMISSIONS, default_permission_ids_for_role
from app.domain.user_roles import PLATFORM_ADMIN_ROLES


async def permissions_for_role(role: str | None) -> list[str]:
    if OPEN_ACCESS_ALL_PERMISSIONS:
        return sorted(ALL_PERMISSION_IDS)
    r = (role or "vendor").strip()
    if r in PLATFORM_ADMIN_ROLES:
        return sorted(ALL_PERMISSION_IDS)
    doc = await db.role_permissions.find_one({"role_id": r})
    if doc and doc.get("permission_ids"):
        return sorted(set(doc["permission_ids"]) & ALL_PERMISSION_IDS)
    return default_permission_ids_for_role(r)


def require_permission(permission_id: str):
    """Require the current user's role to include ``permission_id`` (platform admins imply all)."""

    async def dep(user: dict = Depends(get_current_user)) -> dict:
        perms = set(await permissions_for_role(user.get("role")))
        if permission_id not in perms:
            raise HTTPException(status_code=403, detail="Permission denied")
        return user

    return dep


def require_any_permission(*permission_ids: str):
    """Require at least one of the given permissions (platform admins imply all)."""

    async def dep(user: dict = Depends(get_current_user)) -> dict:
        perms = set(await permissions_for_role(user.get("role")))
        if not permission_ids:
            raise HTTPException(status_code=500, detail="No permissions configured")
        if not perms.intersection(permission_ids):
            raise HTTPException(status_code=403, detail="Permission denied")
        return user

    return dep


async def get_current_user(request: Request) -> dict:
    """Resolve the current user from JWT (cookie or Bearer).

    Access policy: any authenticated user may call all API routes; the ``role``
    field is stored for audit/UI only until fine-grained RBAC is enabled.
    """
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = pyjwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Restrict route to platform administrator role (``admin``)."""
    if user.get("role") not in PLATFORM_ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
