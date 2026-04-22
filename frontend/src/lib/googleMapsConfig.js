/**
 * Google Maps JavaScript API key for browser embeds (Maps JavaScript API).
 * Set REACT_APP_GOOGLE_MAPS_API_KEY in .env for deployments; a dev fallback keeps local builds working.
 */
const DEV_FALLBACK = "AIzaSyCtC_0HfLwBvG3KRI2ZAcAyQqRrkJSeKSE";

export function getGoogleMapsApiKey() {
  const fromEnv = String(process.env.REACT_APP_GOOGLE_MAPS_API_KEY ?? "").trim();
  if (fromEnv && fromEnv !== "undefined") return fromEnv;
  return DEV_FALLBACK;
}
