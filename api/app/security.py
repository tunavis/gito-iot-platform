"""Security utilities for JWT and password management."""

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID
import jwt
import bcrypt
from fastapi import HTTPException, status

from app.config import get_settings


def hash_password(password: str) -> str:
    """Hash password using bcrypt."""
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash."""
    try:
        password_bytes = plain_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except Exception:
        return False


def create_access_token(
    tenant_id: UUID | str,
    user_id: UUID | str,
    user_role: str,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Create JWT access token."""
    settings = get_settings()
    
    if isinstance(tenant_id, UUID):
        tenant_id = str(tenant_id)
    if isinstance(user_id, UUID):
        user_id = str(user_id)
    
    if expires_delta is None:
        expires_delta = timedelta(hours=settings.JWT_EXPIRATION_HOURS)
    
    expire = datetime.now(timezone.utc) + expires_delta
    
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "role": user_role,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    
    token = jwt.encode(
        payload,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    
    return token


def decode_token(token: str) -> dict:
    """Decode and verify JWT token."""
    settings = get_settings()
    
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
