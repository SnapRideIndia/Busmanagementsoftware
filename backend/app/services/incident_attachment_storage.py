"""Incident evidence: AWS S3 only (S3_INCIDENT_BUCKET required for uploads)."""

from __future__ import annotations

from typing import Any

from app.core.config import settings


def _s3_client():
    import boto3

    return boto3.client("s3", region_name=settings.s3_region or None)


def upload_incident_bytes(
    *,
    incident_id: str,
    stored_name: str,
    body: bytes,
    content_type: str,
) -> dict[str, Any]:
    """
    Persist file bytes to S3. Returns fields for Mongo `attachments[]`
    (plus internal keys stripped in public API).
    """
    bucket = (settings.s3_bucket or "").strip()
    if not bucket:
        raise ValueError("S3_INCIDENT_BUCKET is not set; incident attachments require S3.")
    key = f"{settings.s3_key_prefix}{incident_id}/{stored_name}"
    _s3_client().put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType=content_type or "application/octet-stream",
    )
    return {"storage": "s3", "s3_key": key, "stored_name": ""}


def delete_stored_attachment(meta: dict[str, Any], incident_id: str) -> None:
    del incident_id  # S3 keys are absolute; kept for call-site compatibility
    if meta.get("storage") != "s3":
        return
    key = (meta.get("s3_key") or "").strip()
    if not key:
        return
    bucket = (settings.s3_bucket or "").strip()
    if not bucket:
        return
    _s3_client().delete_object(Bucket=bucket, Key=key)


def iter_s3_body_chunks(s3_key: str, chunk_size: int = 65536):
    """Yield bytes chunks for StreamingResponse."""
    bucket = (settings.s3_bucket or "").strip()
    if not bucket:
        raise ValueError("S3_INCIDENT_BUCKET is not set")
    obj = _s3_client().get_object(Bucket=bucket, Key=s3_key)
    body = obj["Body"]
    if hasattr(body, "iter_chunks"):
        for chunk in body.iter_chunks(chunk_size=chunk_size):
            if chunk:
                yield chunk
    else:
        while True:
            chunk = body.read(chunk_size)
            if not chunk:
                break
            yield chunk


def attachment_meta_public(meta: dict[str, Any]) -> dict[str, Any]:
    """Remove server-only keys from one attachment dict."""
    return {k: v for k, v in meta.items() if k not in ("stored_name", "s3_key")}
