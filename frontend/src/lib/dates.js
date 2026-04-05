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
