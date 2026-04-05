import { useState, useEffect, useCallback } from "react";
import API, { formatApiError, buildQuery, unwrapListResponse, fetchAllPaginated, messageFromAxiosError } from "../lib/api";
import TablePaginationBar from "../components/TablePaginationBar";
import AsyncPanel from "../components/AsyncPanel";
import { formatDateIN } from "../lib/dates";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Plus, Send, Trash2, Pencil, MessageSquare, Phone } from "lucide-react";
import { toast } from "sonner";

const today = new Date().toISOString().slice(0, 10);

export default function DutyPage() {
  const [duties, setDuties] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [buses, setBuses] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filterDate, setFilterDate] = useState(today);
  const [filterDepot, setFilterDepot] = useState("");
  const [filterBusId, setFilterBusId] = useState("");
  const [page, setPage] = useState(1);
  const [listMeta, setListMeta] = useState({ total: 0, pages: 1, limit: 20 });
  const [form, setForm] = useState({
    driver_license: "", bus_id: "", route_name: "",
    start_point: "", end_point: "", date: today,
    trips: [
      { trip_number: 1, start_time: "08:00", end_time: "10:00", direction: "outward" },
      { trip_number: 2, start_time: "11:30", end_time: "13:30", direction: "return" }
    ]
  });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = buildQuery({
        date: filterDate,
        depot: filterDepot,
        bus_id: filterBusId,
        page,
        limit: 20,
      });
      const [d, drItems, busItems] = await Promise.all([
        API.get("/duties", { params }),
        fetchAllPaginated("/drivers", {}),
        fetchAllPaginated("/buses", {}),
      ]);
      const du = unwrapListResponse(d.data);
      setDuties(du.items);
      setListMeta({ total: du.total, pages: du.pages, limit: du.limit });
      setDrivers(drItems);
      setBuses(busItems);
    } catch (err) {
      setFetchError(messageFromAxiosError(err, "Failed to load duties"));
      setDuties([]);
    } finally {
      setLoading(false);
    }
  }, [filterDate, filterDepot, filterBusId, page]);
  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => setForm({
    driver_license: "", bus_id: "", route_name: "",
    start_point: "", end_point: "", date: filterDate || today,
    trips: [
      { trip_number: 1, start_time: "08:00", end_time: "10:00", direction: "outward" },
      { trip_number: 2, start_time: "11:30", end_time: "13:30", direction: "return" }
    ]
  });

  const handleSave = async () => {
    if (!form.driver_license || !form.bus_id || !form.route_name || !form.start_point || !form.end_point) {
      toast.error("Please fill all required fields"); return;
    }
    try {
      if (editing) {
        await API.put(`/duties/${editing}`, form);
        toast.success("Duty updated");
      } else {
        await API.post("/duties", form);
        toast.success("Duty assigned");
      }
      setOpen(false); setEditing(null); resetForm(); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Remove this duty assignment?")) return;
    try { await API.delete(`/duties/${id}`); toast.success("Removed"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const sendSms = async (id) => {
    try {
      const { data } = await API.post(`/duties/${id}/send-sms`);
      toast.success(`SMS sent to ${data.phone}`);
      load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const sendAllSms = async () => {
    if (!filterDate) { toast.error("Select a date"); return; }
    try {
      const { data } = await API.post(`/duties/send-all-sms?date=${filterDate}`);
      toast.success(data.message);
      load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const openEdit = (d) => {
    setForm({
      driver_license: d.driver_license, bus_id: d.bus_id, route_name: d.route_name,
      start_point: d.start_point, end_point: d.end_point, date: d.date,
      trips: d.trips || []
    });
    setEditing(d.id); setOpen(true);
  };

  const updateTrip = (idx, field, value) => {
    const newTrips = [...form.trips];
    newTrips[idx] = { ...newTrips[idx], [field]: value };
    setForm({ ...form, trips: newTrips });
  };

  return (
    <div data-testid="duty-page">
      <div className="page-header">
        <h1 className="page-title">Duty Assignments</h1>
        <div className="flex gap-2">
          <Button onClick={sendAllSms} variant="outline" className="text-[#C8102E] border-[#C8102E] hover:bg-red-50" data-testid="send-all-sms-btn">
            <Send size={14} className="mr-1.5" /> Send All SMS
          </Button>
          <Button onClick={() => { resetForm(); setEditing(null); setOpen(true); }} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-duty-btn">
            <Plus size={16} className="mr-1.5" /> Assign Duty
          </Button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-3 mb-6 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Date</label>
          <Input type="date" value={filterDate} onChange={(e) => { setFilterDate(e.target.value); setPage(1); }} className="w-44 rounded-lg" data-testid="duty-date-filter" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
          <Select value={filterDepot || "all"} onValueChange={(v) => { setFilterDepot(v === "all" ? "" : v); setFilterBusId(""); setPage(1); }}>
            <SelectTrigger className="w-44 rounded-lg"><SelectValue placeholder="All Depots" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Depots</SelectItem>
              {[...new Set(buses.map((x) => x.depot).filter(Boolean))].sort().map((dep) => (
                <SelectItem key={dep} value={dep}>{dep}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Bus</label>
          <Select value={filterBusId || "all"} onValueChange={(v) => { setFilterBusId(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-36 rounded-lg"><SelectValue placeholder="All Buses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Buses</SelectItem>
              {(filterDepot ? buses.filter((x) => x.depot === filterDepot) : buses).map((x) => (
                <SelectItem key={x.bus_id} value={x.bus_id}>{x.bus_id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={load} variant="outline" className="rounded-lg" data-testid="duty-filter-btn">Refresh</Button>
      </div>

      {/* Duty Cards */}
      <div className="space-y-3">
        {fetchError ? <AsyncPanel error={fetchError} onRetry={load} minHeight="min-h-[160px]" /> : null}
        {!fetchError && loading && duties.length === 0 ? <AsyncPanel loading minHeight="min-h-[200px]" /> : null}
        {!fetchError && duties.map((d) => (
          <Card key={d.id} className={`border-gray-200 shadow-sm hover:shadow-md transition-shadow ${loading ? "opacity-70" : ""}`} data-testid={`duty-card-${d.id}`}>
            <CardContent className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-xs text-gray-400">{d.id}</span>
                    <Badge className={d.status === "assigned" ? "bg-blue-100 text-blue-700 hover:bg-blue-100" : "bg-green-100 text-green-700 hover:bg-green-100"}>{d.status}</Badge>
                    {d.sms_sent && <Badge className="bg-green-100 text-green-700 hover:bg-green-100"><MessageSquare size={10} className="mr-1" />SMS Sent</Badge>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
                    <div>
                      <p className="text-gray-500 text-xs uppercase">Driver</p>
                      <p className="font-medium">{d.driver_name}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-1"><Phone size={10} />{d.driver_phone}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs uppercase">Bus / Route</p>
                      <p className="font-mono font-medium">{d.bus_id}</p>
                      <p className="text-xs text-gray-500">{d.route_name}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs uppercase">Route</p>
                      <p className="font-medium">{d.start_point} &rarr; {d.end_point}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs uppercase">Trips</p>
                      {d.trips?.map((t) => (
                        <p key={t.trip_number} className="text-xs">
                          <span className="font-medium">Trip {t.trip_number}</span> ({t.direction}): {t.start_time} - {t.end_time}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!d.sms_sent && (
                    <Button variant="outline" size="sm" onClick={() => sendSms(d.id)} className="text-[#C8102E] border-[#C8102E]" data-testid={`sms-duty-${d.id}`}>
                      <Send size={12} className="mr-1" /> SMS
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => openEdit(d)} data-testid={`edit-duty-${d.id}`}><Pencil size={14} /></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)} data-testid={`delete-duty-${d.id}`}><Trash2 size={14} className="text-red-500" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {!fetchError && !loading && duties.length === 0 ? (
          <Card className="border-gray-200"><CardContent className="p-8 text-center text-gray-400">No duties assigned for this date</CardContent></Card>
        ) : null}
        <TablePaginationBar page={page} pages={listMeta.pages} total={listMeta.total} limit={listMeta.limit} onPageChange={setPage} />
      </div>

      {/* Summary Table */}
      {duties.length > 0 && (
        <Card className="mt-6 border-gray-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-base font-medium">Duty Summary — {formatDateIN(filterDate)}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow className="table-header">
                <TableHead>Driver</TableHead><TableHead>Bus</TableHead><TableHead>Route</TableHead>
                <TableHead>Trip 1</TableHead><TableHead>Trip 2</TableHead><TableHead>SMS</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {duties.map((d) => (
                  <TableRow key={d.id} className="hover:bg-[#FAFAFA]">
                    <TableCell className="font-medium">{d.driver_name}</TableCell>
                    <TableCell className="font-mono">{d.bus_id}</TableCell>
                    <TableCell className="text-sm">{d.start_point} &rarr; {d.end_point}</TableCell>
                    <TableCell className="text-sm font-mono">{d.trips?.[0]?.start_time} - {d.trips?.[0]?.end_time}</TableCell>
                    <TableCell className="text-sm font-mono">{d.trips?.[1]?.start_time} - {d.trips?.[1]?.end_time}</TableCell>
                    <TableCell>{d.sms_sent ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Sent</Badge> : <Badge variant="secondary">Pending</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="duty-dialog">
          <DialogHeader><DialogTitle>{editing ? "Edit Duty" : "Assign Duty"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Driver</Label>
                <Select value={form.driver_license} onValueChange={(v) => setForm({ ...form, driver_license: v })}>
                  <SelectTrigger data-testid="duty-driver-select"><SelectValue placeholder="Select driver" /></SelectTrigger>
                  <SelectContent>{drivers.map((d) => <SelectItem key={d.license_number} value={d.license_number}>{d.name} ({d.license_number})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Bus</Label>
                <Select value={form.bus_id} onValueChange={(v) => setForm({ ...form, bus_id: v })}>
                  <SelectTrigger data-testid="duty-bus-select"><SelectValue placeholder="Select bus" /></SelectTrigger>
                  <SelectContent>{buses.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id} ({b.depot})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="duty-date" /></div>
            <div className="space-y-2"><Label>Route Name</Label><Input value={form.route_name} onChange={(e) => setForm({ ...form, route_name: e.target.value })} placeholder="e.g. Miyapur-Secunderabad Express" data-testid="duty-route-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Starting Point</Label><Input value={form.start_point} onChange={(e) => setForm({ ...form, start_point: e.target.value })} placeholder="e.g. Miyapur" data-testid="duty-start-point" /></div>
              <div className="space-y-2"><Label>Ending Point</Label><Input value={form.end_point} onChange={(e) => setForm({ ...form, end_point: e.target.value })} placeholder="e.g. Secunderabad" data-testid="duty-end-point" /></div>
            </div>

            <div className="border-t pt-3">
              <p className="text-sm font-medium mb-3">Trip 1 (Outward: {form.start_point || "Start"} &rarr; {form.end_point || "End"})</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Start Time</Label><Input type="time" value={form.trips[0]?.start_time || ""} onChange={(e) => updateTrip(0, "start_time", e.target.value)} data-testid="trip1-start" /></div>
                <div className="space-y-2"><Label>Arrival Time</Label><Input type="time" value={form.trips[0]?.end_time || ""} onChange={(e) => updateTrip(0, "end_time", e.target.value)} data-testid="trip1-end" /></div>
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-sm font-medium mb-3">Trip 2 (Return: {form.end_point || "End"} &rarr; {form.start_point || "Start"})</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Start Time</Label><Input type="time" value={form.trips[1]?.start_time || ""} onChange={(e) => updateTrip(1, "start_time", e.target.value)} data-testid="trip2-start" /></div>
                <div className="space-y-2"><Label>Arrival Time</Label><Input type="time" value={form.trips[1]?.end_time || ""} onChange={(e) => updateTrip(1, "end_time", e.target.value)} data-testid="trip2-end" /></div>
              </div>
            </div>

            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="duty-save-btn">{editing ? "Update Duty" : "Assign Duty"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
