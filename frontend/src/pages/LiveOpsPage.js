import { useState, useEffect, useCallback } from "react";
import API from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { MapPin, RefreshCw, AlertTriangle } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix leaflet default icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const busIcon = (status) => L.divIcon({
  className: "custom-marker",
  html: `<div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#fff;background:${
    status === "on_route" ? "#16A34A" : status === "at_stop" ? "#F59E0B" : "#2563EB"
  };border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">B</div>`,
  iconSize: [28, 28], iconAnchor: [14, 14],
});

export default function LiveOpsPage() {
  const [liveData, setLiveData] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ld, al] = await Promise.all([API.get("/live-operations"), API.get("/live-operations/alerts")]);
      setLiveData(ld.data); setAlerts(al.data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); const iv = setInterval(refresh, 30000); return () => clearInterval(iv); }, [refresh]);

  return (
    <div data-testid="live-ops-page">
      <div className="page-header">
        <h1 className="page-title">Live Operations</h1>
        <Button onClick={refresh} variant="outline" size="sm" data-testid="live-refresh-btn">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map */}
        <Card className="lg:col-span-2 border-gray-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-base font-medium flex items-center gap-2"><MapPin size={16} /> Track Buses</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[500px] rounded-md overflow-hidden" data-testid="live-map">
              <MapContainer center={[17.385, 78.486]} zoom={12} style={{ height: "100%", width: "100%" }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="OSM" />
                {liveData.map((bus) => (
                  <Marker key={bus.bus_id} position={[bus.lat, bus.lng]} icon={busIcon(bus.status)}>
                    <Popup>
                      <div className="text-sm">
                        <p className="font-bold">{bus.bus_id}</p>
                        <p>Status: {bus.status}</p>
                        <p>Speed: {bus.speed} km/h</p>
                        <p>Type: {bus.bus_type}</p>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
            <div className="flex gap-4 mt-3 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#16A34A]" />On Route ({liveData.filter(b => b.status === "on_route").length})</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#F59E0B]" />At Stop ({liveData.filter(b => b.status === "at_stop").length})</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#2563EB]" />Charging ({liveData.filter(b => b.status === "charging").length})</span>
            </div>
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-base font-medium flex items-center gap-2"><AlertTriangle size={16} /> Alerts</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[520px] overflow-y-auto" data-testid="alerts-list">
              {alerts.map((a) => (
                <div key={a.id} className={`p-3 rounded-md border text-sm ${a.severity === "high" ? "border-red-200 bg-red-50" : a.severity === "medium" ? "border-yellow-200 bg-yellow-50" : "border-gray-200 bg-gray-50"}`} data-testid={`alert-${a.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{a.alert_type}</span>
                    <Badge variant={a.resolved ? "secondary" : "destructive"} className={a.resolved ? "bg-green-100 text-green-700" : ""}>{a.resolved ? "Resolved" : "Active"}</Badge>
                  </div>
                  <p className="text-gray-600">Bus: {a.bus_id}</p>
                  <p className="text-gray-400 text-xs mt-1">{new Date(a.timestamp).toLocaleString()}</p>
                </div>
              ))}
              {alerts.length === 0 && <p className="text-gray-400 text-center py-8">No alerts</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bus Status Table */}
      <Card className="mt-6 border-gray-200 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Bus Status</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Bus ID</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead>
              <TableHead>Speed</TableHead><TableHead>Depot</TableHead><TableHead>Position</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {liveData.map((b) => (
                <TableRow key={b.bus_id} className="hover:bg-gray-50">
                  <TableCell className="font-mono font-medium">{b.bus_id}</TableCell>
                  <TableCell>{b.bus_type}</TableCell>
                  <TableCell>
                    <Badge className={b.status === "on_route" ? "bg-green-100 text-green-700 hover:bg-green-100" : b.status === "at_stop" ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-100" : "bg-blue-100 text-blue-700 hover:bg-blue-100"}>
                      {b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{b.speed} km/h</TableCell>
                  <TableCell>{b.depot}</TableCell>
                  <TableCell className="font-mono text-xs">{b.lat}, {b.lng}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
