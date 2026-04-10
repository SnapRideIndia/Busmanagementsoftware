/** Defaults and labels for duty assignment trips (scheduled vs actual, status, cancellation). */

export const TRIP_STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "not_operated", label: "Not operated" },
];

export const CANCEL_REASON_OPTIONS = [
  { value: "none", label: "—" },
  { value: "no_driver", label: "No driver" },
  { value: "no_conductor", label: "No conductor" },
  { value: "other", label: "Other (custom)" },
];

export const TRIP_DIRECTION_OPTIONS = [
  { value: "outward", label: "Outward" },
  { value: "return", label: "Return" },
];

export function defaultTripsForNewDuty() {
  return [
    { trip_number: 1, trip_id: "", start_point: "", end_point: "", start_time: "08:00", end_time: "10:00", direction: "outward", actual_start_time: "", actual_end_time: "", trip_status: "scheduled", cancel_reason_code: "none", cancel_reason_custom: "" },
    { trip_number: 2, trip_id: "", start_point: "", end_point: "", start_time: "11:30", end_time: "13:30", direction: "return", actual_start_time: "", actual_end_time: "", trip_status: "scheduled", cancel_reason_code: "none", cancel_reason_custom: "" },
  ];
}

export function normalizeTripFromApi(t, index) {
  const raw = t || {};
  return {
    trip_number: raw.trip_number ?? index + 1,
    trip_id: raw.trip_id || "",
    start_point: raw.start_point || "",
    end_point: raw.end_point || "",
    start_time: raw.start_time || "",
    end_time: raw.end_time || "",
    direction: raw.direction || (index === 0 ? "outward" : "return"),
    trip_id: raw.trip_id || "",
    actual_start_time: raw.actual_start_time || "",
    actual_end_time: raw.actual_end_time || "",
    trip_status: (raw.trip_status || "scheduled").toLowerCase(),
    cancel_reason_code: (raw.cancel_reason_code || "none").toLowerCase(),
    cancel_reason_custom: raw.cancel_reason_custom || "",
  };
}

export function normalizeTripsFromApi(trips) {
  const arr = Array.isArray(trips) ? trips : [];
  return arr.map((t, i) => normalizeTripFromApi(t, i));
}

/** New row when adding a trip in the form (1-based trip_number set by caller after insert). */
export function emptyTripRow(indexZeroBased) {
  return {
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
  };
}

export function renumberTrips(trips) {
  return trips.map((t, i) => ({ ...t, trip_number: i + 1 }));
}

export function tripStatusNeedsReason(status) {
  const s = (status || "").toLowerCase();
  return s === "cancelled" || s === "not_operated";
}

export function reasonLabel(code) {
  const o = CANCEL_REASON_OPTIONS.find((x) => x.value === code);
  return o ? o.label : code;
}

export function formatTripReason(t) {
  if (!tripStatusNeedsReason(t.trip_status)) return "";
  const c = t.cancel_reason_code || "none";
  if (c === "other" && (t.cancel_reason_custom || "").trim()) return t.cancel_reason_custom.trim();
  if (c === "other") return "Other";
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
