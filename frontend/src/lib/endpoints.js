/**
 * Centralized API endpoint paths (frontend).
 *
 * All values are relative to axios `baseURL` (see `src/lib/api.js`), so paths must start with `/`.
 * Keep endpoints grouped by domain to avoid missing or duplicating paths across the app.
 */
const enc = encodeURIComponent;

export const Endpoints = {
  auth: {
    me: () => "/auth/me",
    login: () => "/auth/login",
    logout: () => "/auth/logout",
    refresh: () => "/auth/refresh",
    forgotPassword: () => "/auth/forgot-password",
  },

  dashboard: {
    root: () => "/dashboard",
  },

  operations: {
    dutyTemplates: {
      list: () => "/duty-templates",
      create: () => "/duty-templates",
      detail: (templateId) => `/duty-templates/${enc(templateId)}`,
      update: (templateId) => `/duty-templates/${enc(templateId)}`,
      remove: (templateId) => `/duty-templates/${enc(templateId)}`,
    },

    duties: {
      list: () => "/duties",
      create: () => "/duties",
      detail: (dutyId) => `/duties/${enc(dutyId)}`,
      update: (dutyId) => `/duties/${enc(dutyId)}`,
      remove: (dutyId) => `/duties/${enc(dutyId)}`,
      summaryMetrics: () => "/duties/summary-metrics",
      summaryExport: () => "/duties/summary-export",
      sendSms: (dutyId) => `/duties/${enc(dutyId)}/send-sms`,
      cancelFollowingTrips: (dutyId) => `/duties/${enc(dutyId)}/cancel-following-trips`,
      sendAllSms: (date) => `/duties/send-all-sms?date=${enc(date)}`,
    },

    live: {
      telemetryPositions: () => "/telemetry/live-positions",
      alerts: () => "/live-operations/alerts",
    },
  },

  masters: {
    buses: {
      list: () => "/buses",
      create: () => "/buses",
      get: (busId) => `/buses/${enc(busId)}`,
      update: (busId) => `/buses/${enc(busId)}`,
      remove: (busId) => `/buses/${enc(busId)}`,
      assignTender: (busId, tenderId) => `/buses/${enc(busId)}/assign-tender?tender_id=${enc(tenderId)}`,
    },

    drivers: {
      list: () => "/drivers",
      create: () => "/drivers",
      get: (license) => `/drivers/${enc(license)}`,
      update: (license) => `/drivers/${enc(license)}`,
      remove: (license) => `/drivers/${enc(license)}`,
      performance: (license) => `/drivers/${enc(license)}/performance`,
      assignBus: (license, busId) => `/drivers/${enc(license)}/assign-bus?bus_id=${enc(busId)}`,
    },

    conductors: {
      list: () => "/conductors",
      create: () => "/conductors",
      update: (id) => `/conductors/${enc(id)}`,
      remove: (id) => `/conductors/${enc(id)}`,
    },

    depots: {
      list: () => "/depots",
      create: () => "/depots",
      update: (name) => `/depots/${enc(name)}`,
      remove: (name) => `/depots/${enc(name)}`,
    },

    tenders: {
      list: () => "/tenders",
      create: () => "/tenders",
      update: (id) => `/tenders/${enc(id)}`,
      remove: (id) => `/tenders/${enc(id)}`,
    },

    stops: {
      list: () => "/stop-master",
      create: () => "/stop-master",
      update: (stopId) => `/stop-master/${enc(stopId)}`,
      remove: (stopId) => `/stop-master/${enc(stopId)}`,
    },

    terminals: {
      list: () => "/terminal-master",
      create: () => "/terminal-master",
      get: (terminalId) => `/terminal-master/${enc(terminalId)}`,
      update: (terminalId) => `/terminal-master/${enc(terminalId)}`,
      remove: (terminalId) => `/terminal-master/${enc(terminalId)}`,
    },

    geofences: {
      list: () => "/geofences",
      stats: () => "/geofences/stats",
      create: () => "/geofences",
      get: (id) => `/geofences/${enc(id)}`,
      update: () => "/geofences",
      remove: (id) => `/geofences/${enc(id)}`,
      bootstrap: () => "/geofences/bootstrap",
      events: () => "/geofence-events",
    },

    routes: {
      // Legacy alias used by RoutesPage list; backed by the same master.
      legacyList: () => "/route-master",
      list: () => "/bus-routes",
      create: () => "/bus-routes",
      get: (routeId) => `/bus-routes/${enc(routeId)}`,
      update: (routeId) => `/bus-routes/${enc(routeId)}`,
      remove: (routeId) => `/bus-routes/${enc(routeId)}`,
    },

    settings: {
      root: () => "/settings",
      list: () => "/settings",
      upsert: () => "/settings",
    },

    businessRules: {
      root: () => "/business-rules",
      list: () => "/business-rules",
      upsert: () => "/business-rules",
      remove: (key) => `/business-rules/${enc(key)}`,
    },
  },

  incidents: {
    meta: () => "/incidents/meta",
    list: () => "/incidents",
    create: () => "/incidents",
    get: (id) => `/incidents/${enc(id)}`,
    update: (id) => `/incidents/${enc(id)}`,
    addNote: (id) => `/incidents/${enc(id)}/notes`,
    closeInfraction: (incidentId, idx) => `/incidents/${enc(incidentId)}/infractions/${Number(idx)}/close`,
    attachments: (id) => `/incidents/${enc(id)}/attachments`,
    attachmentFile: (incidentId, attachmentId) => `/incidents/${enc(incidentId)}/attachments/${enc(attachmentId)}/file`,
    attachmentFileView: (incidentId, attachmentId) => `/incidents/${enc(incidentId)}/attachments/${enc(attachmentId)}/file?inline=1`,
  },

  infractions: {
    catalogue: () => "/infractions/catalogue",
    logged: () => "/infractions/logged",
    log: () => "/infractions/log",
    close: (id) => `/infractions/${enc(id)}/close`,
  },

  alerts: {
    center: () => "/alerts/center",
  },

  reports: {
    catalog: () => "/reports/catalog",
    run: () => "/reports",
  },

  revenue: {
    details: () => "/revenue/details",
  },

  passengers: {
    details: () => "/passengers/details",
  },

  billing: {
    root: () => "/billing",
    tripIds: () => "/billing/trip-ids",
    generate: () => "/billing/generate",
    get: (id) => `/billing/${enc(id)}`,
    patch: (id) => `/billing/${enc(id)}`,
  },

  energy: {
    root: () => "/energy",
    report: () => "/energy/report",
  },

  kpi: {
    root: () => "/kpi",
    gccEngine: () => "/kpi/gcc-engine",
    feePkCompute: () => "/fee-pk/compute",
  },

  km: {
    details: () => "/km/details",
    summary: () => "/km/summary",
    tripRowPatch: () => "/km/trip-row",
  },

  tripKmApprovals: {
    list: () => "/trip-km-approvals",
    exceptionAction: () => "/trip-km-approvals/exception-action",
    approve: () => "/trip-km-approvals/approve",
    finalize: () => "/trip-km-approvals/finalize",
  },

  admin: {
    users: () => "/users",
    roles: () => "/roles",
    permissionsCatalog: () => "/permissions/catalog",
    permissionsMatrix: () => "/permissions/matrix",
    setRolePermissions: (role) => `/permissions/roles/${enc(role)}`,
    setUserRole: (userId) => `/users/${enc(userId)}/role`,
  },

  deductions: {
    rules: () => "/deductions/rules",
    updateRule: (ruleKey) => `/deductions/rules/${enc(ruleKey)}`,
    apply: () => "/deductions/apply",
  },
};

export default Endpoints;
