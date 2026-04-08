import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import API, { formatApiError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Bus, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("All fields are required"); return; }
    setLoading(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    try {
      const { data } = await API.post(Endpoints.auth.forgotPassword(), { email: forgotEmail });
      setForgotMsg(data.message || "Reset link sent");
    } catch (err) {
      setForgotMsg(formatApiError(err.response?.data?.detail));
    }
  };

  return (
    <div className="min-h-screen flex" data-testid="login-page">
      {/* Left - Image */}
      <div
        className="hidden lg:flex lg:w-1/2 relative items-center justify-center"
        style={{
          backgroundImage: "url(https://images.pexels.com/photos/12382509/pexels-photo-12382509.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940)",
          backgroundSize: "cover", backgroundPosition: "center"
        }}
      >
        <div className="absolute inset-0 bg-[#1F2937]/85" />
        <div className="relative z-10 text-white px-12 max-w-lg">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-lg bg-[#C8102E] flex items-center justify-center">
              <Bus size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ fontFamily: 'Inter' }}>TGSRTC</h1>
              <p className="text-sm text-white/70">Bus Management System</p>
            </div>
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ fontFamily: 'Inter' }}>
            Powering Telangana's Electric Bus Fleet
          </h2>
          <p className="text-white/70 text-sm leading-relaxed">
            Complete fleet management, energy tracking, billing automation, and real-time operations monitoring.
          </p>
        </div>
      </div>

      {/* Right - Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-[#F5F5F5]">
        <Card className="w-full max-w-md shadow-sm border-gray-200">
          <CardHeader className="space-y-1 pb-4">
            <div className="lg:hidden flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-lg bg-[#C8102E] flex items-center justify-center text-white">
                <Bus size={20} />
              </div>
              <span className="font-semibold text-lg text-[#C8102E]" style={{ fontFamily: 'Inter' }}>TGSRTC BMS</span>
            </div>
            <CardTitle className="text-lg font-bold" style={{ fontFamily: 'Inter' }}>Sign in</CardTitle>
            <p className="text-xs text-gray-500">Enter your credentials to access the dashboard</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <div className="bg-red-50 text-red-600 text-sm px-4 py-2.5 rounded-lg border border-red-200" data-testid="login-error">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email" type="email" placeholder="admin@tgsrtc.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  data-testid="login-email-input"
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password" type={showPw ? "text" : "password"} placeholder="Enter password"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    data-testid="login-password-input"
                    className="rounded-lg pr-10"
                  />
                  <button
                    type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <Button
                type="submit" disabled={loading}
                data-testid="login-submit-btn"
                className="w-full bg-[#C8102E] hover:bg-[#A50E25] rounded-lg"
              >
                {loading ? "Signing in..." : "Sign in"}
              </Button>
              <button
                type="button" onClick={() => setForgotOpen(true)}
                data-testid="forgot-password-btn"
                className="text-sm text-[#C8102E] hover:underline w-full text-center block"
              >
                Forgot password?
              </button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleForgot} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="Enter your email" data-testid="forgot-email-input"
              />
            </div>
            {forgotMsg && <p className="text-sm text-green-600">{forgotMsg}</p>}
            <Button type="submit" className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="forgot-submit-btn">
              Send Reset Link
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
