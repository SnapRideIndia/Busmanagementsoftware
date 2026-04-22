# Incident photo evidence — AWS S3 only

Incident attachments are **never** written to the API server’s local disk. Uploads, downloads, and deletes all go through **S3** using `S3_INCIDENT_BUCKET` and standard AWS credentials (or an instance/execution role).

## What you need

1. **AWS account** with permission to create an S3 bucket (or use an existing private bucket).
2. **Bucket** in the same **AWS region** as your app config (e.g. **`ebms-documents`** in **`us-east-1`** — your bucket/region may differ).
3. **IAM credentials** that can `PutObject`, `GetObject`, and `DeleteObject` on objects under your prefix (or `*` on that bucket for simplicity).

## Steps (high level)

1. In **AWS Console → S3 → Create bucket**  
   - Block all public access (keep checked).  
   - Note the **bucket name** and **Region**.

2. In **IAM → Users** (or a role for EC2/ECS): attach a policy allowing the actions above on  
   `arn:aws:s3:::YOUR-BUCKET-NAME/*`  
   (tighten to `YOUR-PREFIX*` if you use a prefix).

3. Create **access keys** if you use an IAM user (Console → Security credentials → Access keys), or attach an **instance profile** to the server and skip keys.

4. On the machine that runs the FastAPI backend, set environment variables (or add to `backend/.env`):

| Variable | Example | Purpose |
|----------|---------|---------|
| `S3_INCIDENT_BUCKET` | `ebms-documents` | **Required** for uploads; must be non-empty |
| `S3_INCIDENT_PREFIX` | `ebms-incidents/` | Key prefix inside the bucket (default ends with `/`) |
| `AWS_REGION` | `us-east-1` | Must match the bucket region |
| `AWS_ACCESS_KEY_ID` | (secret) | Only if not using instance role |
| `AWS_SECRET_ACCESS_KEY` | (secret) | Only if not using instance role |

5. **Restart** the API. Call `GET /api/incidents/meta` and check `upload_limits.storage_s3` is `true` and `s3_bucket` shows your bucket.

6. **Legacy attachments** that were stored only on disk (older deployments) are no longer served: download returns **410** with a message to re-upload after S3 is configured.

## Where config lives in this repo

- **Example env names and comments:** `backend/.env.example`
- **Code:** `backend/app/core/config.py` (`s3_bucket`, `s3_region`, `s3_key_prefix`, `incident_attachments_use_s3`)
- **Upload / download / delete:** `backend/app/services/incident_attachment_storage.py`

## Incident status note

The workflow uses **investigating → Progress (`in_progress`) → closed** only. There is no separate **resolved** status; use **`resolved_at`** (resolution date/time) when you need “fixed on day 1, closed on day 7.”
