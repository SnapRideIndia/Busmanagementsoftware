"""FastAPI dependencies (auth, DB access patterns)."""

from __future__ import annotations

from fastapi import HTTPException, Request
import jwt as pyjwt
from bson import ObjectId

from app.core.database import db
from app.core.security import JWT_ALGORITHM, get_jwt_secret


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
