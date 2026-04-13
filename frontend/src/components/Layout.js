import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  LayoutDashboard,
  FileText,
  Bus,
  Users,
  MapPin,
  Zap,
  BarChart3,
  Receipt,
  FileBarChart,
  AlertTriangle,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Menu,
  IndianRupee,
  Route,
  ClipboardList,
  UsersRound,
  Scale,
  Shield,
  Sliders,
  Warehouse,
  GitBranch,
  Milestone,
  UserCog,
  Ticket,
  Bell,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { ScrollArea } from "../components/ui/scroll-area";
import API from "../lib/api";

/** Grouped like BusmanagementsoftwareNewVersion; routes match App.js */
const navGroups = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/live-tracking", label: "Live Tracking", icon: MapPin },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/duties", label: "Duty Roster", icon: ClipboardList },
      { to: "/incidents", label: "Incidents & Penalties", icon: AlertTriangle },
      { to: "/alerts-center", label: "Alerts Center", icon: AlertTriangle },
      // Deductions UI hidden for now — route kept in App.js (`/deductions`).
      // { to: "/deductions", label: "Deductions", icon: Calculator },
      { to: "/infractions", label: "Infraction Catalogue", icon: Scale },
      { to: "/energy", label: "Energy", icon: Zap },
    ],
  },
  {
    label: "Master Data",
    items: [
      { to: "/tenders", label: "Tenders", icon: FileText },
      { to: "/depots", label: "Depots", icon: Warehouse },
      { to: "/bus-routes", label: "Routes", icon: GitBranch },
      { to: "/bus-stops", label: "Stops", icon: Milestone },
      { to: "/buses", label: "Bus Fleet", icon: Bus },
      { to: "/drivers", label: "Drivers", icon: Users },
      { to: "/conductors", label: "Conductors", icon: Ticket },
    ],
  },
  {
    label: "Finance & SLA",
    items: [
      { to: "/billing", label: "Billing", icon: Receipt },
      { to: "/kpi", label: "KPI", icon: BarChart3 },
      { to: "/gcc-kpi", label: "GCC KPI", icon: Shield },
      { to: "/revenue-details", label: "Revenue", icon: IndianRupee },
      { to: "/km-details", label: "KM Tracking", icon: Route },
      { to: "/passenger-details", label: "Passengers", icon: UsersRound },
      { to: "/business-rules", label: "Business rules", icon: Sliders },
    ],
  },
  {
    label: "Reports & Admin",
    items: [
      { to: "/reports", label: "Reports", icon: FileBarChart },
      { to: "/admin", label: "Admin Console", icon: UserCog },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function itemTestId(label) {
  return `sidebar-${label.toLowerCase().replace(/\s/g, "-")}`;
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(() => navGroups.map((g) => g.label));
  const [notifCount, setNotifCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);

  const loadNotifCount = useCallback(async () => {
    try {
      const { data } = await API.get("/notifications", { params: { limit: 8, unread_only: "true" } });
      setNotifCount(data.unread_count || 0);
      setNotifs(data.items || []);
    } catch {}
  }, []);

  useEffect(() => {
    loadNotifCount();
    const iv = setInterval(loadNotifCount, 30000);
    return () => clearInterval(iv);
  }, [loadNotifCount]);

  const markAllRead = async () => {
    try { await API.put("/notifications/read-all"); setNotifCount(0); setNotifs(n => n.map(x => ({ ...x, read: true }))); } catch {}
  };

  const toggleGroup = (label) => {
    setExpandedGroups((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#F5F5F5]">
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        data-testid="sidebar"
        className={`fixed lg:static z-50 h-full bg-[#1F2937] text-white flex flex-col transition-all duration-200 ${
          collapsed ? "w-[68px]" : "w-64"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex items-center gap-2.5 px-3 sm:px-4 h-12 sm:h-14 border-b border-white/10 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#C8102E] flex items-center justify-center text-white shrink-0">
            <Bus size={16} />
          </div>
          {!collapsed && (
            <span className="font-semibold text-sm tracking-tight" style={{ fontFamily: "Inter" }}>
              TGSRTC BMS
            </span>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <nav className="py-2 px-2 space-y-0.5" data-testid="sidebar-nav">
            {navGroups.map((group) => (
              <div key={group.label}>
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label)}
                    className="w-full flex items-center justify-between px-2.5 py-1 text-[11px] uppercase tracking-[0.06em] font-bold text-gray-500 hover:text-gray-300"
                  >
                    {group.label}
                    {expandedGroups.includes(group.label) ? (
                      <ChevronDown className="w-3 h-3 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 shrink-0" />
                    )}
                  </button>
                )}
                {(collapsed || expandedGroups.includes(group.label)) && (
                  <div className="space-y-0.5 pb-1">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        data-testid={itemTestId(item.label)}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                          `sidebar-item ${isActive ? "active" : "text-gray-400"} ${
                            collapsed ? "justify-center px-2" : ""
                          }`
                        }
                      >
                        <item.icon size={18} className="shrink-0" />
                        {!collapsed && <span>{item.label}</span>}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </ScrollArea>

        <div className="px-2 py-2 border-t border-white/10 hidden lg:block shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="sidebar-item w-full justify-center text-gray-400 hover:text-white"
            data-testid="sidebar-toggle"
            type="button"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-12 sm:h-14 bg-white border-b border-gray-200 flex items-center justify-between px-3 md:px-5 shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
              onClick={() => setMobileOpen(true)}
              data-testid="mobile-menu-btn"
              type="button"
            >
              <Menu size={20} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => { setNotifOpen(!notifOpen); if (!notifOpen) loadNotifCount(); }}
                className="relative p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
                data-testid="notification-bell"
                type="button"
              >
                <Bell size={18} />
                {notifCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-[#DC2626] text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {notifCount > 99 ? "99+" : notifCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-96 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 overflow-hidden" data-testid="notification-panel">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                      <span className="text-sm font-bold text-gray-900">Notifications</span>
                      {notifCount > 0 && (
                        <button onClick={markAllRead} className="text-[10px] text-[#C8102E] font-bold hover:underline" type="button">Mark all read</button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifs.length === 0 && <p className="text-center text-gray-400 text-xs py-8">No notifications</p>}
                      {notifs.map((n) => (
                        <div key={n.id} className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${!n.read ? "bg-red-50/30" : ""}`}>
                          <div className="flex items-start gap-2">
                            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${!n.read ? "bg-[#DC2626]" : "bg-gray-300"}`} />
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-bold text-gray-900 truncate">{n.subject}</p>
                              <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{n.body?.slice(0, 120)}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[9px] text-gray-400">{n.type === "email" ? "Email" : "SMS"} to {n.recipient_role}</span>
                                <span className="text-[9px] text-gray-300">{n.created_at?.slice(0, 16).replace("T", " ")}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-[#1A1A1A]">{user?.name || "User"}</p>
              <p className="text-xs text-gray-500 capitalize">{user?.role?.replace("_", " ") || ""}</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#C8102E] text-white flex items-center justify-center text-xs font-semibold">
              {(user?.name || "U")[0]}
            </div>
            <button
              onClick={handleLogout}
              data-testid="logout-btn"
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
              title="Logout"
              type="button"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 md:p-5">{children}</main>
      </div>
    </div>
  );
}
