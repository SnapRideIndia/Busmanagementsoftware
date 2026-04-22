import { useState, useMemo } from "react";
import { useBuses, useAllBuses } from "../features/buses/api/useBuses";
import { useBusMutations } from "../features/buses/api/useBusMutations";
import { useAllDepotNames } from "../features/depots/api/useDepots";
import { useAllTenders } from "../features/tenders/api/useTenders";
import API from "../lib/api";
import { Endpoints } from "../lib/endpoints";
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
import { Plus, Pencil, Trash2, Eye, Link } from "lucide-react";
import { toast } from "sonner";

const emptyBus = { bus_id: "", bus_type: "12m_ac", capacity: "40", tender_id: "", depot: "", status: "active", annual_assured_km_override: "" };

function formatTariffRsCell(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
}

export default function BusPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyBus);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignBus, setAssignBus] = useState("");
  const [assignTender, setAssignTender] = useState("");
  const [filterDepot, setFilterDepot] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);

  // TanStack Queries
  const { data: depotOptions = [] } = useAllDepotNames();
  const { data: busData, isLoading: loadingBuses, error: busError, refetch: refetchBuses } = useBuses({
    depot: filterDepot,
    status: filterStatus,
    search: filterSearch,
    page,
    limit,
  });
  const { data: allBusesForAssign = [] } = useAllBuses({ enabled: assignOpen });
  const { data: tenders = [] } = useAllTenders({ enabled: assignOpen });

  const buses = busData?.items || [];
  const listMeta = useMemo(() => ({
    total: busData?.total || 0,
    pages: busData?.pages || 1,
    limit: busData?.limit || limit,
  }), [busData, limit]);

  // Mutations
  const { createBus, updateBus, deleteBus, assignTender: assignTenderMutation } = useBusMutations();

  const handleSave = async () => {
    const payload = {
      ...form,
      capacity: Number(form.capacity),
      annual_assured_km_override:
        form.annual_assured_km_override === "" || form.annual_assured_km_override == null ? 0 : Number(form.annual_assured_km_override),
    };

    if (editing) {
      updateBus.mutate({ busId: editing, payload }, {
        onSuccess: () => { setOpen(false); setEditing(null); setForm(emptyBus); }
      });
    } else {
      createBus.mutate(payload, {
        onSuccess: () => { setOpen(false); setEditing(null); setForm(emptyBus); }
      });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this bus?")) return;
    deleteBus.mutate(id);
  };

  const viewDetail = async (id) => {
    try {
      const { data } = await API.get(Endpoints.masters.buses.get(id));
      setDetail(data);
      setDetailOpen(true);
    } catch (err) {
      console.error("Failed to load bus detail", err);
    }
  };

  const handleAssign = async () => {
    assignTenderMutation.mutate({ busId: assignBus, tenderId: assignTender }, {
      onSuccess: () => setAssignOpen(false)
    });
  };

  const busTypeLabel = (t) => ({ "12m_ac": "12m AC", "9m_ac": "9m AC", "12m_non_ac": "12m Non-AC", "9m_non_ac": "9m Non-AC" }[t] || t);

  return (
    <div data-testid="bus-page">
      <div className="page-header">
        <h1 className="page-title">Bus Fleet</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAssignOpen(true)} data-testid="assign-tender-btn">
            <Link size={14} className="mr-1.5" /> Assign Tender
          </Button>
          <Button onClick={() => { setForm(emptyBus); setEditing(null); setOpen(true); }} className="bg-[#C8102E] hover:bg-[#A50E25]" data-testid="add-bus-btn">
            <Plus size={16} className="mr-1.5" /> Add Bus
          </Button>
        </div>
      </div>
      <p className="page-desc mb-3 max-w-3xl">
        Fleet register by depot, tender, and vehicle type. Assured km (yearly) comes from the tender’s Annual Assured Bus Kilometers, or from the bus override if set. “—” means neither is set. Base and actual electricity tariffs use billing business rules (default Rs. 5/kWh each); actual is meter-weighted for the current month when charging rows include tariff.
      </p>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Search</label>
          <Input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Bus ID, tender, depot, type…"
            className="w-[min(100%,280px)]"
            data-testid="bus-filter-search"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase text-gray-500">Depot</label>
          <Select value={filterDepot || "all"} onValueChange={(v) => { setFilterDepot(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All Depots" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Depots</SelectItem>
              {depotOptions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
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
          <div className="w-full overflow-x-auto" data-testid="bus-fleet-table-scroll">
            <Table className="text-[12px] min-w-[1100px]">
            <TableHeader><TableRow className="table-header">
              <TableHead>Bus ID</TableHead><TableHead>Type</TableHead><TableHead>Capacity</TableHead>
              <TableHead>Tender</TableHead><TableHead>Depot</TableHead>
              <TableHead className="text-right whitespace-nowrap">Assured km (yr)</TableHead>
              <TableHead className="whitespace-nowrap">kWh/km</TableHead>
              <TableHead className="text-right whitespace-nowrap">Allowed Monthly Energy (kWh)</TableHead>
              <TableHead className="text-right whitespace-nowrap">Actual Monthly Energy (kWh)</TableHead>
              <TableHead className="text-right whitespace-nowrap">Base Electricity Tariff (Rs/kWh)</TableHead>
              <TableHead className="text-right whitespace-nowrap">Actual Electricity Tariff (Rs/kWh)</TableHead>
              <TableHead className="text-right whitespace-nowrap">Variance (kWh)</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={14}
                loading={loadingBuses}
                error={busError}
                onRetry={refetchBuses}
                isEmpty={buses.length === 0}
                emptyMessage="No buses found"
              >
                {buses.map((b) => (
                  <TableRow key={b.bus_id} className="hover:bg-gray-50" data-testid={`bus-row-${b.bus_id}`}>
                    <TableCell className="font-mono font-medium">{b.bus_id}</TableCell>
                    <TableCell>{busTypeLabel(b.bus_type)}</TableCell>
                    <TableCell className="font-mono">{b.capacity}</TableCell>
                    <TableCell className="font-mono text-[12px]">{b.tender_id || "-"}</TableCell>
                    <TableCell>{b.depot || "-"}</TableCell>
                    <TableCell className="text-right font-mono">
                      {b.assured_km_yearly != null
                        ? Number(b.assured_km_yearly).toLocaleString(undefined, { maximumFractionDigits: 0 })
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono">{b.kwh_per_km}</TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(b.base_energy_kwh ?? b.allowed_monthly_energy ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(b.actual_energy_kwh ?? b.actual_monthly_energy ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatTariffRsCell(b.base_electricity_tariff)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatTariffRsCell(b.actual_electricity_tariff)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${Number(b.monthly_energy_variance || 0) > 0 ? "text-red-600" : "text-green-700"}`}>
                      {Number(b.monthly_energy_variance || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge className={b.status === "active" ? "bg-green-100 text-green-700 hover:bg-green-100" : b.status === "maintenance" ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-100" : "bg-gray-100 text-gray-600 hover:bg-gray-100"}>
                        {b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => viewDetail(b.bus_id)} data-testid={`view-bus-${b.bus_id}`}><Eye size={14} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => {
                          setForm({
                            ...b,
                            capacity: String(b.capacity ?? ""),
                            annual_assured_km_override: b.annual_assured_km_override > 0 ? String(b.annual_assured_km_override) : "",
                          });
                          setEditing(b.bus_id);
                          setOpen(true);
                        }} data-testid={`edit-bus-${b.bus_id}`}><Pencil size={14} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(b.bus_id)} data-testid={`delete-bus-${b.bus_id}`}><Trash2 size={14} className="text-red-500" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableLoadRows>
            </TableBody>
          </Table>
          </div>
          <TablePaginationBar 
            page={page} 
            pages={listMeta.pages} 
            total={listMeta.total} 
            limit={listMeta.limit} 
            onPageChange={setPage} 
            onLimitChange={setLimit}
          />
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="bus-dialog">
          <DialogHeader><DialogTitle>{editing ? "Edit Bus" : "Add Bus"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Bus ID</Label><Input value={form.bus_id} onChange={(e) => setForm({ ...form, bus_id: e.target.value })} disabled={!!editing} data-testid="bus-id-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.bus_type} onValueChange={(v) => setForm({ ...form, bus_type: v })}>
                  <SelectTrigger data-testid="bus-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12m_ac">12m AC</SelectItem><SelectItem value="9m_ac">9m AC</SelectItem>
                    <SelectItem value="12m_non_ac">12m Non-AC</SelectItem><SelectItem value="9m_non_ac">9m Non-AC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Capacity</Label><Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} data-testid="bus-capacity" /></div>
            </div>
            <div className="space-y-2">
              <Label>Annual assured km override (per year, optional)</Label>
              <Input
                type="number"
                min={0}
                placeholder="Leave empty to use tender only"
                value={form.annual_assured_km_override}
                onChange={(e) => setForm({ ...form, annual_assured_km_override: e.target.value })}
                data-testid="bus-assured-override"
              />
              <p className="text-[11px] text-gray-500">If set, this value is shown instead of the tender’s annual assured km (Article 22.3.1).</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Depot</Label><Input value={form.depot} onChange={(e) => setForm({ ...form, depot: e.target.value })} data-testid="bus-depot" /></div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger data-testid="bus-status"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="maintenance">Maintenance</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleSave} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="bus-save-btn">{editing ? "Update" : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg" data-testid="bus-detail-dialog">
          <DialogHeader><DialogTitle>Bus Details - {detail?.bus_id}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-gray-500">Type:</span> {busTypeLabel(detail.bus_type)}</div>
                <div><span className="text-gray-500">Capacity:</span> {detail.capacity}</div>
                <div><span className="text-gray-500">Tender:</span> {detail.tender_id || "None"}</div>
                <div><span className="text-gray-500">Assured km (yr):</span>{" "}
                  {detail.assured_km_yearly != null
                    ? Number(detail.assured_km_yearly).toLocaleString()
                    : "—"}
                  {Number(detail.annual_assured_km_override || 0) > 0 ? (
                    <span className="text-gray-400 text-xs ml-1">(override)</span>
                  ) : null}
                </div>
                <div><span className="text-gray-500">Depot:</span> {detail.depot || "None"}</div>
                <div><span className="text-gray-500">kWh/km:</span> {detail.kwh_per_km}</div>
                <div><span className="text-gray-500">Allowed monthly energy:</span> {Number(detail.base_energy_kwh ?? detail.allowed_monthly_energy ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh</div>
                <div><span className="text-gray-500">Actual monthly energy:</span> {Number(detail.actual_energy_kwh ?? detail.actual_monthly_energy ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh</div>
                <div><span className="text-gray-500">Base electricity tariff:</span>{" "}
                  {detail.base_electricity_tariff != null && detail.base_electricity_tariff !== ""
                    ? `Rs. ${Number(detail.base_electricity_tariff).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kWh`
                    : "—"}
                </div>
                <div><span className="text-gray-500">Actual electricity tariff:</span>{" "}
                  {detail.actual_electricity_tariff != null && detail.actual_electricity_tariff !== ""
                    ? `Rs. ${Number(detail.actual_electricity_tariff).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kWh`
                    : "—"}
                </div>
                <div><span className="text-gray-500">Monthly variance:</span> {Number(detail.monthly_energy_variance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh</div>
                <div><span className="text-gray-500">Status:</span> {detail.status}</div>
              </div>
              <p className="text-gray-500 font-medium mt-3">Recent Trips: {detail.trips?.length || 0}</p>
              <p className="text-gray-500 font-medium">Energy Records: {detail.energy?.length || 0}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign Tender Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent data-testid="assign-dialog">
          <DialogHeader><DialogTitle>Assign Tender to Bus</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Bus</Label>
              <Select value={assignBus} onValueChange={setAssignBus}>
                <SelectTrigger data-testid="assign-bus-select"><SelectValue placeholder="Select bus" /></SelectTrigger>
                <SelectContent>{allBusesForAssign.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tender</Label>
              <Select value={assignTender} onValueChange={setAssignTender}>
                <SelectTrigger data-testid="assign-tender-select"><SelectValue placeholder="Select tender" /></SelectTrigger>
                <SelectContent>{tenders.map((t) => <SelectItem key={t.tender_id} value={t.tender_id}>{t.tender_id} - {t.description}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={handleAssign} className="w-full bg-[#C8102E] hover:bg-[#A50E25]" data-testid="assign-save-btn">Assign</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
