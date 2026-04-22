import axios from "axios";
import { Endpoints } from "./endpoints";

const ACCESS_TOKEN_KEY = "ebms_access_token";
const REFRESH_TOKEN_KEY = "ebms_refresh_token";

/**
 * Backend origin without trailing slash.
 * In dev, default to localhost:8000 when env is unset so requests don't go to the CRA dev server as `/api/...` (404).
 * In production, empty means same-origin `/api` (reverse proxy).
 */
export function getBackendOrigin() {
  const raw = String(process.env.REACT_APP_BACKEND_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (raw && raw !== "undefined") {
    const isBrowserHttps = typeof window !== "undefined" && window.location.protocol === "https:";
    if (isBrowserHttps && raw.startsWith("http://")) {
      console.warn("Ignoring insecure REACT_APP_BACKEND_URL on an HTTPS page. Falling back to same-origin /api.");
      return "";
    }
    return raw;
  }
  if (process.env.NODE_ENV === "development") return "http://localhost:8000";
  return "";
}

const apiBaseURL = (() => {
  const origin = getBackendOrigin();
  return origin ? `${origin}/api` : "/api";
})();

if (typeof console !== "undefined") {
  console.info("[API CONFIG] backend origin:", getBackendOrigin() || "(same-origin)");
  console.info("[API CONFIG] axios baseURL:", apiBaseURL);
}

const API = axios.create({
  baseURL: apiBaseURL,
  withCredentials: true,
});

export function getStoredAccessToken() {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY) || "";
}

export function getStoredRefreshToken() {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY) || "";
}

export function storeAuthTokens(accessToken, refreshToken = "") {
  if (accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  }
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

export function clearStoredAuthTokens() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

API.interceptors.request.use((config) => {
  const resolvedBase = String(config.baseURL || apiBaseURL || "");
  const resolvedPath = String(config.url || "");
  const resolvedUrl = /^https?:\/\//i.test(resolvedPath) ? resolvedPath : `${resolvedBase.replace(/\/+$/, "")}/${resolvedPath.replace(/^\/+/, "")}`;
  if (typeof console !== "undefined" && process.env.NODE_ENV === "development") {
    console.info(`[API REQUEST] ${String(config.method || "GET").toUpperCase()} ${resolvedUrl}`);
  }
  const token = getStoredAccessToken();
  if (token && !config.headers?.Authorization) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    };
  }
  return config;
});

API.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401 && !err.config._retry) {
      // Don't try to refresh if we're already on login page or checking auth status
      if (window.location.pathname === "/login" || err.config.url?.includes("/auth/me")) {
        return Promise.reject(err);
      }

      err.config._retry = true;
      try {
        const refreshToken = getStoredRefreshToken();
        const refreshHeaders = refreshToken ? { Authorization: `Bearer ${refreshToken}` } : {};
        const { data } = await axios.post(`${apiBaseURL}${Endpoints.auth.refresh()}`, null, {
          withCredentials: true,
          headers: refreshHeaders,
        });
        if (data?.token || data?.refresh_token) {
          storeAuthTokens(data.token || "", data.refresh_token || "");
        }
        return API(err.config);
      } catch {
        clearStoredAuthTokens();
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  },
);

/** Omit empty values and literal "all" so query params match backend filters. */
export function buildQuery(params) {
  const q = {};
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    if (typeof v === "string" && v.trim().toLowerCase() === "all") return;
    q[k] = v;
  });
  return q;
}

/** Full GET URL for duty summary export (PDF/Excel); same auth cookies as the app origin when proxied. */
export function buildDutiesSummaryExportUrl(fmt, filters) {
  const params = new URLSearchParams();
  Object.entries(buildQuery(filters)).forEach(([k, v]) => params.set(k, String(v)));
  params.set("fmt", fmt);
  const origin = getBackendOrigin();
  const base = origin ? `${origin}/api` : "/api";
  return `${base}/duties/summary-export?${params.toString()}`;
}

/** Normalize `{ items, total, page, limit, pages }` from paginated list APIs. */
export function unwrapListResponse(data) {
  if (data && Array.isArray(data.items)) {
    return {
      items: data.items,
      total: Number(data.total) || 0,
      page: Number(data.page) || 1,
      limit: Number(data.limit) || 20,
      pages: Number(data.pages) || 1,
    };
  }
  if (Array.isArray(data)) {
    return { items: data, total: data.length, page: 1, limit: data.length, pages: 1 };
  }
  return { items: [], total: 0, page: 1, limit: 20, pages: 1 };
}

/** Backend list routes use `limit` max 100; use this for single requests that need the largest page. */
export const LIST_PAGE_MAX = 100;

/**
 * Walks all pages of a paginated list endpoint until every row is loaded.
 * @param {string} path - e.g. "/buses"
 * @param {Record<string, unknown>} baseParams - extra query params (filters), not including page/limit
 */
export async function fetchAllPaginated(path, baseParams = {}, pageLimit = LIST_PAGE_MAX) {
  const items = [];
  let page = 1;
  let pages = 1;
  do {
    const { data } = await API.get(path, { params: { ...baseParams, page, limit: pageLimit } });
    const u = unwrapListResponse(data);
    items.push(...u.items);
    pages = Math.max(1, u.pages);
    page += 1;
  } while (page <= pages);
  return items;
}

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => e?.msg || JSON.stringify(e))
      .filter(Boolean)
      .join(" ");
  if (detail?.msg) return detail.msg;
  return String(detail);
}

/** Prefer FastAPI `detail`, then axios/network message, then fallback (avoids masking JS errors). */
export function messageFromAxiosError(err, fallback = "Something went wrong.") {
  const detail = err?.response?.data?.detail;
  if (detail != null) return formatApiError(detail);
  const status = err?.response?.status;
  if (status != null) {
    if (status >= 500) return "Server error. Please try again.";
    if (status === 404) return "Not found.";
  }
  if (err?.code === "ERR_NETWORK") {
    return "Cannot reach the server. Check your connection and that the API is running.";
  }
  if (typeof err?.message === "string" && err.message.trim()) return err.message;
  return fallback;
}

export default API;
