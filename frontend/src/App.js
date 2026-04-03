import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import TenderPage from "./pages/TenderPage";
import BusPage from "./pages/BusPage";
import DriverPage from "./pages/DriverPage";
import LiveOpsPage from "./pages/LiveOpsPage";
import EnergyPage from "./pages/EnergyPage";
import KpiPage from "./pages/KpiPage";
import DeductionPage from "./pages/DeductionPage";
import BillingPage from "./pages/BillingPage";
import ReportsPage from "./pages/ReportsPage";
import IncidentPage from "./pages/IncidentPage";
import SettingsPage from "./pages/SettingsPage";
import RevenueDetailPage from "./pages/RevenueDetailPage";
import KmDetailPage from "./pages/KmDetailPage";
import DutyPage from "./pages/DutyPage";
import PassengerDetailPage from "./pages/PassengerDetailPage";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA]">
      <div className="w-8 h-8 border-3 border-[#134219] border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" richColors />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/tenders" element={<ProtectedRoute><TenderPage /></ProtectedRoute>} />
          <Route path="/buses" element={<ProtectedRoute><BusPage /></ProtectedRoute>} />
          <Route path="/drivers" element={<ProtectedRoute><DriverPage /></ProtectedRoute>} />
          <Route path="/live-operations" element={<ProtectedRoute><LiveOpsPage /></ProtectedRoute>} />
          <Route path="/energy" element={<ProtectedRoute><EnergyPage /></ProtectedRoute>} />
          <Route path="/kpi" element={<ProtectedRoute><KpiPage /></ProtectedRoute>} />
          <Route path="/deductions" element={<ProtectedRoute><DeductionPage /></ProtectedRoute>} />
          <Route path="/billing" element={<ProtectedRoute><BillingPage /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
          <Route path="/incidents" element={<ProtectedRoute><IncidentPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/revenue-details" element={<ProtectedRoute><RevenueDetailPage /></ProtectedRoute>} />
          <Route path="/km-details" element={<ProtectedRoute><KmDetailPage /></ProtectedRoute>} />
          <Route path="/duties" element={<ProtectedRoute><DutyPage /></ProtectedRoute>} />
          <Route path="/passenger-details" element={<ProtectedRoute><PassengerDetailPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
