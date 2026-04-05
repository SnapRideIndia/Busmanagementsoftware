import axios from "axios";

/**
 * Backend origin without trailing slash.
 * In dev, default to localhost:8000 when env is unset so requests don't go to the CRA dev server as `/api/...` (404).
 * In production, empty means same-origin `/api` (reverse proxy).
 */
export function getBackendOrigin() {
  const raw = String(process.env.REACT_APP_BACKEND_URL ?? "").trim().replace(/\/+$/, "");
  if (raw && raw !== "undefined") return raw;
  if (process.env.NODE_ENV === "development") return "http://localhost:8000";
  return "";
}

const apiBaseURL = (() => {
  const origin = getBackendOrigin();
  return origin ? `${origin}/api` : "/api";
})();

const API = axios.create({
  baseURL: apiBaseURL,
  withCredentials: true,
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
        await API.post("/auth/refresh");
        return API(err.config);
      } catch {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
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
    return detail.map((e) => e?.msg || JSON.stringify(e)).filter(Boolean).join(" ");
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
