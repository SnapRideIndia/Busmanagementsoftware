/** Duty assign/edit form helpers (feature-local). */

export function hhmmToMinutes(v) {
  if (!v || typeof v !== "string" || !v.includes(":")) return null;
  const [h, m] = v.split(":").map((x) => Number(x));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function dutyWindowMinutes(start, end) {
  if (start == null || end == null) return null;
  if (end >= start) return end - start;
  return 24 * 60 - start + end;
}

/** First-column label for a scheduled break row, e.g. `BREAK ( 45 Min)`. */
export function breakRowPrimaryLabel(startTime, endTime) {
  const s = hhmmToMinutes(String(startTime || "").trim());
  const e = hhmmToMinutes(String(endTime || "").trim());
  const dur = dutyWindowMinutes(s, e);
  if (s == null || e == null || dur == null) return "BREAK ( — )";
  return `BREAK ( ${dur} Min)`;
}

export function buildPunctualityReviewFromDuty(duty, existing = {}) {
  const violations = [];
  const schedDep = hhmmToMinutes(duty?.punctuality_scheduled_departure);
  const actualDep = hhmmToMinutes(duty?.punctuality_actual_departure);
  const schedArr = hhmmToMinutes(duty?.punctuality_scheduled_arrival);
  const actualArr = hhmmToMinutes(duty?.punctuality_actual_arrival);
  if (schedDep != null && actualDep != null) {
    const variance = actualDep - schedDep;
    if (variance > 5) {
      violations.push({
        rule_key: "duty:start_late",
        violation_type: "start_late",
        scheduled: duty?.punctuality_scheduled_departure || "",
        actual: duty?.punctuality_actual_departure || "",
        variance_minutes: variance,
        allowed_minutes: 5,
        message: `Start time delayed by ${variance} min (allowed 5 min).`,
      });
    }
  }
  if (schedDep != null && schedArr != null && actualArr != null) {
    const duration = Math.max(1, dutyWindowMinutes(schedDep, schedArr) || 1);
    const allowed = Math.floor(Math.min(15, duration * 0.1));
    const variance = dutyWindowMinutes(schedArr, actualArr) ?? actualArr - schedArr;
    if (variance > allowed) {
      violations.push({
        rule_key: "duty:arrival_late",
        violation_type: "arrival_late",
        scheduled: duty?.punctuality_scheduled_arrival || "",
        actual: duty?.punctuality_actual_arrival || "",
        variance_minutes: variance,
        allowed_minutes: allowed,
        message: `Arrival delayed by ${variance} min (allowed ${allowed} min).`,
      });
    }
  }
  const prevByKey = new Map((existing?.decisions || []).map((d) => [d.rule_key, d]));
  const decisions = violations.map((v) => ({
    rule_key: v.rule_key,
    enabled: Boolean(prevByKey.get(v.rule_key)?.enabled),
    reason: prevByKey.get(v.rule_key)?.reason || "",
  }));
  return { policy: "punctuality", violations, decisions };
}
