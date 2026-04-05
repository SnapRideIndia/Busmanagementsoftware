import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  LayoutDashboard, FileText, Bus, Users, MapPin, Zap,
  BarChart3, Calculator, Receipt, FileBarChart, AlertTriangle,
  Settings, LogOut, ChevronLeft, ChevronRight, Menu, IndianRupee, Route,
  ClipboardList, UsersRound, Shield, Sliders, Scale,   Warehouse, GitBranch, Milestone,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/tenders", label: "Tenders", icon: FileText },
  { to: "/depots", label: "Depots", icon: Warehouse },
  { to: "/bus-routes", label: "Routes", icon: GitBranch },
  { to: "/bus-stops", label: "Stops", icon: Milestone },
  { to: "/buses", label: "Bus Master", icon: Bus },
  { to: "/drivers", label: "Drivers", icon: Users },
  { to: "/duties", label: "Duty Roster", icon: ClipboardList },
  { to: "/live-operations", label: "Live Operations", icon: MapPin },
  { to: "/energy", label: "Energy", icon: Zap },
  { to: "/kpi", label: "KPI", icon: BarChart3 },
  { to: "/deductions", label: "Deductions", icon: Calculator },
  { to: "/infractions", label: "Infractions", icon: Scale },
  { to: "/gcc-kpi", label: "GCC KPI", icon: Shield },
  { to: "/billing", label: "Billing", icon: Receipt },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle },
  { to: "/revenue-details", label: "Revenue", icon: IndianRupee },
  { to: "/km-details", label: "KM Tracking", icon: Route },
  { to: "/passenger-details", label: "Passengers", icon: UsersRound },
  { to: "/business-rules", label: "Business rules", icon: Sliders },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#F5F5F5]">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        data-testid="sidebar"
        className={`fixed lg:static z-50 h-full bg-[#1F2937] text-white flex flex-col transition-all duration-200 ${
          collapsed ? "w-[68px]" : "w-64"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#C8102E] flex items-center justify-center text-white shrink-0">
            <Bus size={16} />
          </div>
          {!collapsed && (
            <span className="font-semibold text-sm tracking-tight" style={{ fontFamily: 'Inter' }}>
              TGSRTC BMS
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-testid={`sidebar-${item.label.toLowerCase().replace(/\s/g, "-")}`}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `sidebar-item ${isActive ? "active" : "text-gray-400"} ${collapsed ? "justify-center px-2" : ""}`
              }
            >
              <item.icon size={18} className="shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="px-2 py-2 border-t border-white/10 hidden lg:block">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="sidebar-item w-full justify-center text-gray-400 hover:text-white"
            data-testid="sidebar-toggle"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-8 shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
              onClick={() => setMobileOpen(true)}
              data-testid="mobile-menu-btn"
            >
              <Menu size={20} />
            </button>
            <div className="hidden lg:block h-1 w-16 bg-[#C8102E] rounded-full" />
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-[#1A1A1A]">{user?.name || "User"}</p>
              <p className="text-xs text-gray-500 capitalize">{user?.role?.replace("_", " ") || ""}</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-[#C8102E] text-white flex items-center justify-center text-sm font-medium">
              {(user?.name || "U")[0]}
            </div>
            <button
              onClick={handleLogout}
              data-testid="logout-btn"
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
