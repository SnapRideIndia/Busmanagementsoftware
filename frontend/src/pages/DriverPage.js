import { useState, useEffect, useCallback } from "react";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated, messageFromAxiosError } from "../lib/api";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Plus, Pencil, Trash2, BarChart3, Link } from "lucide-react";
import { toast } from "sonner";

const emptyDriver = { name: "", license_number: "", phone: "", bus_id: "", status: "active" };

export default function DriverPage() {
  const [drivers, setDrivers] = useState([]);
  const [buses, setBuses] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyDriver);
  const [perfOpen, setPerfOpen] = useState(false);
  const [perf, setPerf] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDriver, setAssignDriver] = useState("");
  const [assignBus, setAssignBus] = useState("");
  const [filterDepot, setFilterDepot] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [depotNames, setDepotNames] = useState([]);
  const [allDriversForAssign, setAllDriversForAssign] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const depots = await fetchAllPaginated("/depots", {});
        setDepotNames(depots.map((x) => x.name).filter(Boolean).sort());
      } catch {
        setDepotNames([]);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const drivers = await fetchAllPaginated("/drivers", {});
        setAllDriversForAssign(drivers);
      } catch {
        setAllDriversForAssign([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [d, busItems] = await Promise.all([
        API.get("/drivers", { params: buildQuery({ depot: filterDepot, status: filterStatus, page, limit: 20 }) }),
        fetchAllPaginated("/buses", {}),
      ]);
      const du = unwrapListResponse(d.data);
      setDrivers(du.items);
      setMeta({ total: du.total, pages: du.pages, limit: du.limit });
      setBuses(busItems);
    } catch (err) {
      setFetchError(messageFromAxiosError(err, "Failed to load drivers"));
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  }, [filterDepot, filterStatus, page]);
  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    try {
      if (editing) { await API.put(`/drivers/${editing}`, form); toast.success("Driver updated"); }
      else { await API.post("/drivers", form); toast.success("Driver added"); }
      setOpen(false); setEditing(null); setForm(emptyDriver); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleDelete = async (lic) => {
    if (!window.confirm("Delete this driver?")) return;
    try { await API.delete(`/drivers/${lic}`); toast.success("Deleted"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const viewPerf = async (lic) => {
    try { const { data } = await API.get(`/drivers/${lic}/performance`); setPerf(data); setPerfOpen(true); }
    catch {}
  };

  const handleAssign = async () => {
    try {
      await API.put(`/drivers/${assignDriver}/assign-bus?bus_id=${assignBus}`);
      toast.success("Bus assigned"); setAssignOpen(false); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  return (
    <div data-testid="driver-page">
      <div className="page-header">
        <h1 className="page-title">Driver Management</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAssignOpen(true)} data-testid="assign-driver-btn"><Link size={14} className="mr-1.5" /> Assign Bus</Button>
          <Button onClick={() => { setForm(emptyDriver); setEditing(null); setOpen(true); }} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-driver-btn">
            <Plus size={16} className="mr-1.5" /> Add Driver
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Depot (by assigned bus)</label>
          <Select value={filterDepot || "all"} onValueChange={(v) => { setFilterDepot(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All Depots" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Depots</SelectItem>
              {depotNames.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Status</label>
          <Select value={filterStatus || "all"} onValueChange={(v) => { setFilterStatus(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">active</SelectItem>
              <SelectItem value="inactive">inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="table-header">
              <TableHead>Name</TableHead><TableHead>License</TableHead><TableHead>Phone</TableHead>
              <TableHead>Bus</TableHead><TableHead>Rating</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={7}
                loading={loading}
                error={fetchError}
                onRetry={load}
                isEmpty={drivers.length === 0}
                emptyMessage="No drivers found"
              >
                {drivers.map((d) => (
                  <TableRow key={d.license_number} className="hover:bg-gray-50" data-testid={`driver-row-${d.license_number}`}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="font-mono text-sm">{d.license_number}</TableCell>
                    <TableCell>{d.phone || "-"}</TableCell>
                    <TableCell className="font-mono">{d.bus_id || "-"}</TableCell>
                    <TableCell>
                      <span
                        className={`font-mono font-medium ${
                          (d.rating ?? 0) >= 4.5 ? "text-green-600" : (d.rating ?? 0) >= 3.5 ? "text-yellow-600" : "text-red-600"
                        }`}
                      >
                        {(d.rating ?? 0).toFixed(1)}
                        <span className="text-gray-400 font-normal text-xs ml-0.5">/ 5</span>
                      </span>
                    </TableCell>
                    <TableCell><Badge className={d.status === "active" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-gray-100 text-gray-600 hover:bg-gray-100"}>{d.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => viewPerf(d.license_number)} data-testid={`perf-driver-${d.license_number}`}><BarChart3 size={14} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { setForm(d); setEditing(d.license_number); setOpen(true); }} data-testid={`edit-driver-${d.license_number}`}><Pencil size={14} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(d.license_number)} data-testid={`delete-driver-${d.license_number}`}><Trash2 size={14} className="text-red-500" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableLoadRows>
            </TableBody>
          </Table>
          <TablePaginationBar page={page} pages={meta.pages} total={meta.total} limit={meta.limit} onPageChange={setPage} />
        </CardContent>
      </Card>

      {/* Add/Edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="driver-dialog">
          <DialogHeader><DialogTitle>{editing ? "Edit Driver" : "Add Driver"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="driver-name" /></div>
            <div className="space-y-2"><Label>License Number</Label><Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} disabled={!!editing} data-testid="driver-license" /></div>
            <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="driver-phone" /></div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="driver-status"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="driver-save-btn">{editing ? "Update" : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Performance */}
      <Dialog open={perfOpen} onOpenChange={setPerfOpen}>
        <DialogContent data-testid="driver-perf-dialog">
          <DialogHeader><DialogTitle>Driver Performance</DialogTitle></DialogHeader>
          {perf && (
            <div className="space-y-3">
              <p className="font-medium text-lg">{perf.driver?.name}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="kpi-card">
                  <p className="text-xs text-gray-500 uppercase">Rating (out of 5)</p>
                  <p className="text-xl font-mono font-bold">
                    {(perf.rating ?? 0).toFixed(1)}
                    <span className="text-sm text-gray-500 font-normal"> / 5</span>
                  </p>
                </div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Total KM</p><p className="text-xl font-mono font-bold">{perf.total_km?.toLocaleString()}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Total Trips</p><p className="text-xl font-mono font-bold">{perf.total_trips}</p></div>
                <div className="kpi-card"><p className="text-xs text-gray-500 uppercase">Incidents</p><p className="text-xl font-mono font-bold">{perf.incidents}</p></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign Bus */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent data-testid="assign-bus-dialog">
          <DialogHeader><DialogTitle>Assign Bus to Driver</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Driver</Label>
              <Select value={assignDriver} onValueChange={setAssignDriver}>
                <SelectTrigger data-testid="assign-driver-select"><SelectValue placeholder="Select driver" /></SelectTrigger>
                <SelectContent>{allDriversForAssign.map((d) => <SelectItem key={d.license_number} value={d.license_number}>{d.name} ({d.license_number})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Bus</Label>
              <Select value={assignBus} onValueChange={setAssignBus}>
                <SelectTrigger data-testid="assign-bus-select-driver"><SelectValue placeholder="Select bus" /></SelectTrigger>
                <SelectContent>{buses.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={handleAssign} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="assign-driver-save-btn">Assign</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
