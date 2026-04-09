/** Indian-style date display (DD/MM/YYYY). Input: ISO date string, YYYY-MM-DD, or Date. */

export function formatDateIN(value) {
  if (value == null || value === "") return "—";
  const s = String(value).trim();
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${d}/${m}/${y}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    return new Date(t).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }
  return s;
}

/** Date + time in en-IN (24h). ISO strings and timestamps OK. */
export function formatDateTimeIN(value) {
  if (value == null || value === "") return "—";
  const t = Date.parse(String(value).trim());
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Date + time in en-IN with 12-hour clock and AM/PM (for incident logs / tables). */
export function formatDateTimeINAmPm(value) {
  if (value == null || value === "") return "—";
  const t = Date.parse(String(value).trim());
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Short axis label for charts (DD/MM). */
export function formatChartAxisDate(value) {
  if (value == null || value === "") return "";
  const s = String(value).trim();
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    return `${ymd[3]}/${ymd[2]}`;
  }
  return formatDateIN(value);
}

/** Recharts <Tooltip /> labelFormatter for date x-axis. */
export function rechartsDateLabelFormatter(label) {
  return formatDateIN(label);
}
