/**
 * KPI detail routing labels and cross-links (metrics come from GET /kpi/gcc-engine).
 */

export const VALID_KPI_SLUGS = ["reliability", "availability", "punctuality", "frequency", "safety", "trip_speed"];

export const kpiDetailLabels = {
  reliability: "Reliability (BF)",
  availability: "Availability",
  punctuality: "Punctuality",
  frequency: "Frequency",
  safety: "Safety (MAF)",
  trip_speed: "Trip speed",
};

/** Related slugs for cross-links on detail pages */
export const relatedKpis = {
  reliability: ["frequency", "availability"],
  availability: ["frequency", "punctuality"],
  punctuality: ["frequency", "safety"],
  frequency: ["reliability", "availability", "safety"],
  safety: ["reliability", "frequency"],
  trip_speed: ["punctuality", "frequency"],
};
