"""Simulated notification service — logs to DB + console.
Wire to real SendGrid/Twilio by replacing _send_email/_send_sms."""

import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

TGSRTC_EMAIL = "rohith@maratech.in"
CONCESSIONAIRE_EMAIL = "rohith77665@gmail.com"

async def _store_notification(db, notif: dict):
    notif["id"] = f"NOTIF-{uuid.uuid4().hex[:8].upper()}"
    notif["created_at"] = datetime.now(timezone.utc).isoformat()
    notif["read"] = False
    await db.notifications.insert_one(notif)
    notif.pop("_id", None)
    return notif

def _send_email(to: str, subject: str, body: str):
    """Simulated email — logs to console. Replace with SendGrid/Resend call."""
    logger.info(f"[EMAIL-SIM] To: {to} | Subject: {subject} | Body: {body[:200]}")

def _send_sms(to: str, message: str):
    """Simulated SMS — logs to console. Replace with Twilio/MSG91 call."""
    logger.info(f"[SMS-SIM] To: {to} | Message: {message[:200]}")


async def notify_infraction_created(db, incident: dict, infractions: list):
    """Send alerts when an infraction/incident is created — to TGSRTC and Concessionaire."""
    inc_id = incident.get("id", "")
    bus_id = incident.get("bus_id", "")
    depot = incident.get("depot", "")
    inc_type = incident.get("incident_type", "")
    desc = incident.get("description", "")[:100]
    inf_codes = ", ".join(str(inf.get("infraction_code", "")) for inf in infractions) or "N/A"
    total_amt = sum(float(inf.get("amount", 0) or 0) for inf in infractions)

    subject = f"TGSRTC EBMS Alert: New Incident {inc_id} — {inc_type}"
    body = (
        f"Incident ID: {inc_id}\n"
        f"Type: {inc_type}\n"
        f"Bus: {bus_id} | Depot: {depot}\n"
        f"Infractions: {inf_codes}\n"
        f"Estimated Penalty: Rs.{total_amt:,.0f}\n"
        f"Description: {desc}\n"
        f"Action Required: Review and assign team."
    )
    sms_msg = f"TGSRTC: Incident {inc_id} on {bus_id}. Infraction {inf_codes}, Rs.{total_amt:,.0f}. Review required."

    # TGSRTC notification
    _send_email(TGSRTC_EMAIL, subject, body)
    await _store_notification(db, {
        "type": "email", "channel": "incident_created",
        "recipient": TGSRTC_EMAIL, "recipient_role": "tgsrtc",
        "subject": subject, "body": body,
        "incident_id": inc_id, "bus_id": bus_id, "depot": depot,
    })

    # Concessionaire notification
    _send_email(CONCESSIONAIRE_EMAIL, subject, body)
    await _store_notification(db, {
        "type": "email", "channel": "incident_created",
        "recipient": CONCESSIONAIRE_EMAIL, "recipient_role": "concessionaire",
        "subject": subject, "body": body,
        "incident_id": inc_id, "bus_id": bus_id, "depot": depot,
    })

    # SMS to both
    _send_sms(TGSRTC_EMAIL, sms_msg)
    await _store_notification(db, {
        "type": "sms", "channel": "incident_created",
        "recipient": TGSRTC_EMAIL, "recipient_role": "tgsrtc",
        "subject": f"Incident {inc_id}", "body": sms_msg,
        "incident_id": inc_id, "bus_id": bus_id,
    })
    _send_sms(CONCESSIONAIRE_EMAIL, sms_msg)
    await _store_notification(db, {
        "type": "sms", "channel": "incident_created",
        "recipient": CONCESSIONAIRE_EMAIL, "recipient_role": "concessionaire",
        "subject": f"Incident {inc_id}", "body": sms_msg,
        "incident_id": inc_id, "bus_id": bus_id,
    })


async def notify_escalation_deadline_crossed(db, escalated_items: list):
    """Send alerts when infractions cross their resolve deadline."""
    if not escalated_items:
        return
    count = len(escalated_items)
    total = sum(e.get("escalated_amount", 0) for e in escalated_items)
    details = "\n".join(
        f"  - {e['infraction_code']} on {e.get('bus_id','')} | {e['category']}>{e['escalated_category']} | Rs.{e['escalated_amount']:,.0f} ({e['overdue_days']}d overdue)"
        for e in escalated_items[:10]
    )

    subject = f"TGSRTC EBMS: {count} Infraction(s) Crossed Resolve Deadline — Rs.{total:,.0f} Escalated"
    body = (
        f"{count} infractions have crossed their resolve deadline.\n"
        f"Total escalated penalty: Rs.{total:,.0f}\n\n"
        f"Top items:\n{details}\n\n"
        f"Action Required: Resolve or verify rectification immediately to prevent further escalation."
    )
    sms_msg = f"TGSRTC: {count} overdue infractions, Rs.{total:,.0f} escalated. Resolve urgently."

    for recipient, role in [(TGSRTC_EMAIL, "tgsrtc"), (CONCESSIONAIRE_EMAIL, "concessionaire")]:
        _send_email(recipient, subject, body)
        await _store_notification(db, {
            "type": "email", "channel": "escalation_deadline",
            "recipient": recipient, "recipient_role": role,
            "subject": subject, "body": body,
            "escalation_count": count, "escalated_total": total,
        })
        _send_sms(recipient, sms_msg)
        await _store_notification(db, {
            "type": "sms", "channel": "escalation_deadline",
            "recipient": recipient, "recipient_role": role,
            "subject": f"Escalation Alert", "body": sms_msg,
            "escalation_count": count,
        })


async def notify_auto_late_incident(db, incident: dict, bus_id: str, delay_minutes: int):
    """Notify when auto-incident is created for late bus."""
    inc_id = incident.get("id", "")
    subject = f"TGSRTC Auto-Alert: Bus {bus_id} Late by {delay_minutes} min — Incident {inc_id}"
    body = (
        f"Auto-generated incident for late departure/arrival.\n"
        f"Bus: {bus_id} | Delay: {delay_minutes} minutes\n"
        f"Infraction: A16 — Late out of bus more than 15 minutes\n"
        f"Penalty: Rs.100 (Category A, 1-day resolve)\n"
        f"Incident ID: {inc_id}"
    )
    sms_msg = f"TGSRTC: Bus {bus_id} late by {delay_minutes}min. Auto-incident {inc_id} created. A16 Rs.100."

    for recipient, role in [(TGSRTC_EMAIL, "tgsrtc"), (CONCESSIONAIRE_EMAIL, "concessionaire")]:
        _send_email(recipient, subject, body)
        await _store_notification(db, {
            "type": "email", "channel": "auto_late_incident",
            "recipient": recipient, "recipient_role": role,
            "subject": subject, "body": body,
            "incident_id": inc_id, "bus_id": bus_id, "delay_minutes": delay_minutes,
        })
        _send_sms(recipient, sms_msg)
        await _store_notification(db, {
            "type": "sms", "channel": "auto_late_incident",
            "recipient": recipient, "recipient_role": role,
            "subject": f"Late Bus {bus_id}", "body": sms_msg,
            "incident_id": inc_id, "bus_id": bus_id,
        })
