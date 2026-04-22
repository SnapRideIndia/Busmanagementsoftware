/** Defaults and labels for duty assignment trips (status, cancellation, manual leg %). */

/** True for a route leg; false for a scheduled break row (lunch, etc.). */
export function isDutyTripLeg(t) {
  return (t?.segment_type || "trip") !== "break";
}

export const TRIP_STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed (Auto)" },
  { value: "cancelled", label: "Cancelled" },
];

const NON_DEDUCTIBLE_CANCEL = [
  { value: "none", label: "—" },
  { value: "force_majeure", label: "Force Majeure Event" },
  { value: "bus_safety_measure", label: "Bus Safety Measure" },
  { value: "authority_default", label: "Authority Default" },
  { value: "maintenance_depot_delay", label: "Maintenance Depot Delay" },
  { value: "road_accident_not_operator_fault", label: "Road Accident (Not Operator Fault)" },
  { value: "power_supply_failure", label: "Power Supply Failure" },
  { value: "operational_route_blockade", label: "Operational Route Blockade" },
  { value: "authority_govt_instruction", label: "Authority / Govt Instruction" },
];

/** Staff + mechanical deductible reasons (single optgroup label in UI). */
const DEDUCTIBLE_CANCEL = [
  { value: "staff_insufficient_cover", label: "Staff — insufficient cover" },
  { value: "staff_sickness_on_duty", label: "Staff — sickness on duty" },
  { value: "staff_suspension_no_replacement", label: "Staff — suspension, no replacement" },
  { value: "mech_insufficient_buses", label: "Mechanical — insufficient buses" },
  { value: "mech_non_serviceable_bus", label: "Mechanical — non-serviceable bus" },
  { value: "mech_breakdown_en_route", label: "Mechanical — breakdown en route" },
];

/** Grouped for UI: non-deductible vs all deductible reasons together. */
export const CANCEL_REASON_GROUPS = [
  { label: "Non-deductible", options: NON_DEDUCTIBLE_CANCEL },
  { label: "Deductibles", options: DEDUCTIBLE_CANCEL },
];

/** Flat list for selects that need every value (e.g. cascade cancel dialog). */
export const CANCEL_REASON_OPTIONS = [
  ...NON_DEDUCTIBLE_CANCEL,
  ...DEDUCTIBLE_CANCEL,
];

export const DEDUCTIBLE_CANCEL_CODES = new Set(DEDUCTIBLE_CANCEL.map((x) => x.value));

const CANCEL_REASON_LABELS = {
  none: "—",
  force_majeure: "Force Majeure Event",
  bus_safety_measure: "Bus Safety Measure",
  authority_default: "Authority Default",
  maintenance_depot_delay: "Maintenance Depot Delay",
  road_accident_not_operator_fault: "Road Accident (Not Operator Fault)",
  power_supply_failure: "Power Supply Failure",
  operational_route_blockade: "Operational Route Blockade",
  authority_govt_instruction: "Authority / Govt Instruction",
  other: "Other (legacy)",
  staff_insufficient_cover: "Staff — insufficient cover",
  staff_sickness_on_duty: "Staff — sickness on duty",
  staff_suspension_no_replacement: "Staff — suspension, no replacement",
  mech_insufficient_buses: "Mechanical — insufficient buses",
  mech_non_serviceable_bus: "Mechanical — non-serviceable bus",
  mech_breakdown_en_route: "Mechanical — breakdown en route",
  no_driver: "No Driver",
  no_conductor: "No Conductor",
};

const CANONICAL_CANCEL_REASON_CODES = new Set(CANCEL_REASON_OPTIONS.map((x) => x.value));

export function normalizeCancelReasonCode(raw) {
  const code = String(raw || "none").trim().toLowerCase();
  if (code === "other") return "authority_default";
  if (CANONICAL_CANCEL_REASON_CODES.has(code)) return code;
  if (code === "no_driver" || code === "no_conductor") return "authority_default";
  return "none";
}

export function isDeductibleCancelCode(raw) {
  return DEDUCTIBLE_CANCEL_CODES.has(normalizeCancelReasonCode(raw));
}

/**
 * Whole-duty completion (same basis as API `round_trip_completion_pct`): (completed legs / N) × 100.
 * Each leg is still a full route run; this is only a summary of how many legs completed.
 */
export function roundTripCompletionPct(trips) {
  const legs = (Array.isArray(trips) ? trips : []).filter(isDutyTripLeg);
  if (!legs.length) return null;
  const completed = legs.filter((t) => (t.trip_status || "").toLowerCase() === "completed").length;
  return Math.round((1000 * completed) / legs.length) / 10;
}

/** Every route leg is cancelled / not operated (e.g. round trip cancelled while duty row may still be `assigned`). */
export function isDutyRoundTripFullyCancelled(trips) {
  const legs = (Array.isArray(trips) ? trips : []).filter(isDutyTripLeg);
  if (!legs.length) return false;
  return legs.every((t) => {
    const s = String(t?.trip_status || "").toLowerCase();
    return s === "cancelled" || s === "not_operated";
  });
}

/**
 * Duty list / summary badge text: if API still says `assigned` but all legs are cancelled, show `cancelled`.
 */
export function dutyListStatusLabel(duty) {
  const raw = String(duty?.status ?? "").trim().toLowerCase();
  if (raw === "assigned" && isDutyRoundTripFullyCancelled(duty?.trips)) return "cancelled";
  return String(duty?.status ?? "—");
}

/** Tailwind classes for the duty list status badge. */
export function dutyListStatusBadgeClass(duty) {
  const label = dutyListStatusLabel(duty).toLowerCase();
  if (label === "cancelled") return "bg-red-100 text-red-800 hover:bg-red-100";
  if (label === "assigned") return "bg-blue-100 text-blue-700 hover:bg-blue-100";
  return "bg-green-100 text-green-700 hover:bg-green-100";
}

/** Parse manual status % from form input; empty → null; clamp 0–100, one decimal. */
export function parseManualStatusPct(raw) {
  if (raw === "" || raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

export function formatManualStatusPctDisplay(t) {
  const v = t?.manual_status_pct;
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 10) / 10}%`;
}

/**
 * Schedule S band when the leg is not 100% complete (manual % under 100).
 * Under 25% → O13, 25% to under 60% → O14, 60% to under 100% → O15.
 */
export function scheduleSOCodeHintFromManualPct(pct) {
  if (pct === null || pct === undefined || pct === "") return null;
  const n = Number(pct);
  if (!Number.isFinite(n) || n >= 100) return null;
  if (n < 25) return "O13";
  if (n < 60) return "O14";
  return "O15";
}

export const TRIP_DIRECTION_OPTIONS = [
  { value: "outward", label: "Outward" },
  { value: "return", label: "Return" },
];

export function defaultTripsForNewDuty() {
  return [
    { segment_type: "trip", break_label: "", trip_number: 1, trip_id: "", start_point: "", end_point: "", start_time: "08:00", end_time: "10:00", direction: "outward", actual_start_time: "", actual_end_time: "", trip_status: "scheduled", cancel_reason_code: "none", cancel_reason_custom: "", manual_status_pct: null, add_to_incidents: false },
    { segment_type: "trip", break_label: "", trip_number: 2, trip_id: "", start_point: "", end_point: "", start_time: "11:30", end_time: "13:30", direction: "return", actual_start_time: "", actual_end_time: "", trip_status: "scheduled", cancel_reason_code: "none", cancel_reason_custom: "", manual_status_pct: null, add_to_incidents: false },
  ];
}

export function normalizeTripFromApi(t, index) {
  const raw = t || {};
  let status = (raw.trip_status || "scheduled").toLowerCase();
  if (status === "not_operated") status = "cancelled";
  const rawCode = String(raw.cancel_reason_code || "none").toLowerCase();
  const normCode = normalizeCancelReasonCode(rawCode);
  let msp = raw.manual_status_pct;
  if (msp !== null && msp !== undefined && msp !== "") {
    const n = Number(msp);
    msp = Number.isFinite(n) ? parseManualStatusPct(n) : null;
  } else {
    msp = null;
  }
  const seg = String(raw.segment_type || "trip").toLowerCase() === "break" ? "break" : "trip";
  const base = {
    segment_type: seg,
    break_label: String(raw.break_label || "").trim(),
    trip_number: raw.trip_number ?? index + 1,
    trip_id: raw.trip_id || "",
    start_point: raw.start_point || "",
    end_point: raw.end_point || "",
    start_time: raw.start_time || "",
    end_time: raw.end_time || "",
    direction: raw.direction || (index === 0 ? "outward" : "return"),
    actual_start_time: raw.actual_start_time || "",
    actual_end_time: raw.actual_end_time || "",
    trip_status: status,
    cancel_reason_code: normCode,
    cancel_reason_custom: "",
    manual_status_pct: msp,
    add_to_incidents: Boolean(raw.add_to_incidents),
  };
  if (seg === "break") {
    return {
      ...base,
      trip_status: "scheduled",
      cancel_reason_code: "none",
      manual_status_pct: null,
      add_to_incidents: false,
    };
  }
  return base;
}

export function normalizeTripsFromApi(trips) {
  const arr = Array.isArray(trips) ? trips : [];
  return arr.map((t, i) => normalizeTripFromApi(t, i));
}

/** New row when adding a trip in the form (1-based trip_number set by caller after insert). */
export function emptyTripRow(indexZeroBased) {
  return {
    segment_type: "trip",
    break_label: "",
    trip_number: indexZeroBased + 1,
    trip_id: "",
    start_point: "",
    end_point: "",
    start_time: "",
    end_time: "",
    direction: indexZeroBased % 2 === 0 ? "outward" : "return",
    actual_start_time: "",
    actual_end_time: "",
    trip_status: "scheduled",
    cancel_reason_code: "none",
    cancel_reason_custom: "",
    manual_status_pct: null,
    add_to_incidents: false,
  };
}

/** Scheduled break between legs (start_time / end_time = break window). */
export function emptyBreakRow(indexZeroBased) {
  return {
    segment_type: "break",
    break_label: "",
    trip_number: indexZeroBased + 1,
    trip_id: "",
    start_point: "",
    end_point: "",
    start_time: "12:00",
    end_time: "12:45",
    direction: "outward",
    actual_start_time: "",
    actual_end_time: "",
    trip_status: "scheduled",
    cancel_reason_code: "none",
    cancel_reason_custom: "",
    manual_status_pct: null,
    add_to_incidents: false,
  };
}

export function renumberTrips(trips) {
  return trips.map((t, i) => ({ ...t, trip_number: i + 1 }));
}

/** Apply route A/B terminals only to trip legs; leave break rows unchanged. */
export function deriveTripTerminalsForRoute(trips, routeStart, routeEnd) {
  let legIndex = 0;
  return (trips || []).map((t) => {
    if (!isDutyTripLeg(t)) {
      return { ...t };
    }
    const dir = (t.direction || (legIndex % 2 === 0 ? "outward" : "return")).toLowerCase();
    legIndex += 1;
    const sp = dir === "return" ? routeEnd : routeStart;
    const ep = dir === "return" ? routeStart : routeEnd;
    return { ...t, direction: dir, start_point: t.start_point || sp || "", end_point: t.end_point || ep || "" };
  });
}

export function firstTripLeg(trips) {
  return (trips || []).find(isDutyTripLeg);
}

export function lastTripLeg(trips) {
  const arr = trips || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (isDutyTripLeg(arr[i])) return arr[i];
  }
  return undefined;
}

/** After removing index `idx`, at least one trip leg must remain. */
export function canRemoveDutyRow(trips, idx) {
  if (!trips?.length || trips.length <= 1) return false;
  const next = trips.filter((_, j) => j !== idx);
  return next.some(isDutyTripLeg);
}

export function tripStatusNeedsReason(status) {
  const s = (status || "").toLowerCase();
  return s === "cancelled" || s === "not_operated";
}

export function reasonLabel(code) {
  return CANCEL_REASON_LABELS[String(code || "").toLowerCase()] || String(code || "");
}

export function formatTripReason(t) {
  if (!tripStatusNeedsReason(t.trip_status)) return "";
  const c = normalizeCancelReasonCode(t.cancel_reason_code || "none");
  return reasonLabel(c);
}

/** Badge styles for trip_status chips (list + summary views). */
export function tripStatusBadgeClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "completed") return "bg-green-100 text-green-800 hover:bg-green-100";
  if (s === "cancelled" || s === "not_operated") return "bg-red-100 text-red-800 hover:bg-red-100";
  return "bg-slate-100 text-slate-700 hover:bg-slate-100";
}

/** Display time or em dash for duty trip cells. */
export function dutyDashTime(v) {
  return v && String(v).trim() ? v : "—";
}

/**
 * When a leg is cancelled with a valid reason and there are still scheduled legs after it,
 * we can offer "Cancel round trip" to cancel those remaining legs with the same reason.
 * Picks the highest trip_number among cancelled legs that still have scheduled trips below (covers
 * trip 1 cancelled → rest, or trip 1 completed + trip 2 cancelled → 3+).
 */
export function findRoundTripCancelAnchor(trips) {
  const list = (Array.isArray(trips) ? trips : []).filter(isDutyTripLeg);
  const enriched = list.map((t, i) => ({
    t,
    n: Number(t?.trip_number ?? i + 1),
  }));
  enriched.sort((a, b) => a.n - b.n);

  for (let i = enriched.length - 1; i >= 0; i--) {
    const { t, n } = enriched[i];
    const st = (t?.trip_status || "").toLowerCase();
    if (st !== "cancelled") continue;
    const code = normalizeCancelReasonCode(t?.cancel_reason_code || "none");
    if (code === "none" || !code) continue;

    const hasScheduledBelow = enriched.some((row) => row.n > n && (row.t?.trip_status || "").toLowerCase() === "scheduled");
    if (!hasScheduledBelow) continue;

    return {
      afterTripNumber: n,
      cancelReasonCode: code,
      cancelReasonCustom: "",
    };
  }
  return null;
}
