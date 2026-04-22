import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useDutyDetail, useDutyMutations } from "@/features/duty/api/useDuties";
import { useAllDrivers } from "@/features/drivers/api/useDrivers";
import { useAllConductors } from "@/features/conductors/api/useConductors";
import { useAllBuses } from "@/features/buses/api/useBuses";
import { useAllRoutes } from "@/features/routes/api/useRoutes";
import API, { messageFromAxiosError } from "../../lib/api";
import { Endpoints } from "../../lib/endpoints";
import AsyncPanel from "../../components/AsyncPanel";
import HeaderSecondary from "../../components/HeaderSecondary";
import DutyFormBody from "@/features/duty/components/DutyFormBody";
import { buildPunctualityReviewFromDuty } from "@/features/duty/lib/dutyFormHelpers";
import {
  defaultTripsForNewDuty,
  normalizeTripsFromApi,
  tripStatusNeedsReason,
  normalizeCancelReasonCode,
  emptyTripRow,
  emptyBreakRow,
  renumberTrips,
  findRoundTripCancelAnchor,
  parseManualStatusPct,
  isDutyTripLeg,
  deriveTripTerminalsForRoute,
  firstTripLeg,
  lastTripLeg,
  canRemoveDutyRow,
} from "@/features/duty/lib/dutyTrips";
import { Button } from "../../components/ui/button";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const today = new Date().toISOString().slice(0, 10);

export default function DutyAssignEditPage() {
  const navigate = useNavigate();
  const { dutyId } = useParams();
  const [searchParams] = useSearchParams();
  const dateFromQuery = searchParams.get("date") || "";

  const isEdit = Boolean(dutyId);

  const [form, setForm] = useState({
    template_id: "",
    driver_license: "",
    conductor_id: "",
    bus_id: "",
    route_id: "",
    route_name: "",
    start_point: "",
    end_point: "",
    punctuality_scheduled_departure: "",
    punctuality_scheduled_arrival: "",
    punctuality_actual_departure: "",
    punctuality_actual_arrival: "",
    attribution_context: "",
    duty_exception_reason: "",
    schedule_s_single_infraction: false,
    punctuality_review: { policy: "punctuality", violations: [], decisions: [] },
    date: dateFromQuery || today,
    trips: defaultTripsForNewDuty(),
    duty_dates: [],
  });
  const [editBaseline, setEditBaseline] = useState(null);
  const [editing, setEditing] = useState(null);
  const [routeSelectExtra, setRouteSelectExtra] = useState([]);

  const { data: drivers = [] } = useAllDrivers();
  const { data: conductors = [] } = useAllConductors();
  const { data: buses = [] } = useAllBuses();
  const { data: routes = [] } = useAllRoutes();

  const { data: dutyData, isLoading: dutyLoading, error: dutyError, refetch: loadDutyDetail } = useDutyDetail(dutyId);
  const { createDuty, updateDuty, cancelFollowingTrips } = useDutyMutations();

  const pageLoading = isEdit ? dutyLoading : false;
  const fetchError = dutyError ? messageFromAxiosError(dutyError, "Failed to load duty detail") : null;

  const routesForSelect = useMemo(() => {
    const seen = new Set(routes.map((r) => String(r.route_id ?? "").trim()));
    const out = [...routes];
    for (const ex of routeSelectExtra) {
      const id = String(ex.route_id ?? "").trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(ex);
      }
    }
    return out;
  }, [routes, routeSelectExtra]);

  const selectedRoute = useMemo(
    () => routes.find((r) => String(r.route_id ?? "").trim() === String(form.route_id ?? "").trim()),
    [routes, form.route_id]
  );

  const isRtcFault = form.attribution_context === "rtc_fault";
  const roundTripCancelAnchor = useMemo(() => findRoundTripCancelAnchor(form.trips), [form.trips]);

  const dutyTripsSignature = (trips) => JSON.stringify(renumberTrips(trips || []));

  const buildDutyPatch = (baseline, current) => {
    if (!baseline) return {};
    const patch = {};
    if ((current.driver_license || "") !== (baseline.driver_license || "")) patch.driver_license = current.driver_license;
    if ((current.conductor_id || "") !== (baseline.conductor_id || "")) patch.conductor_id = current.conductor_id;
    if ((current.bus_id || "") !== (baseline.bus_id || "")) patch.bus_id = current.bus_id;
    if (String(current.route_id || "") !== String(baseline.route_id || "")) {
      patch.route_id = String(current.route_id || "");
    }
    if ((current.date || "") !== (baseline.date || "")) patch.date = current.date;
    if ((current.punctuality_scheduled_departure || "") !== (baseline.punctuality_scheduled_departure || "")) patch.punctuality_scheduled_departure = current.punctuality_scheduled_departure;
    if ((current.punctuality_scheduled_arrival || "") !== (baseline.punctuality_scheduled_arrival || "")) patch.punctuality_scheduled_arrival = current.punctuality_scheduled_arrival;
    if ((current.punctuality_actual_departure || "") !== (baseline.punctuality_actual_departure || "")) patch.punctuality_actual_departure = current.punctuality_actual_departure;
    if ((current.punctuality_actual_arrival || "") !== (baseline.punctuality_actual_arrival || "")) patch.punctuality_actual_arrival = current.punctuality_actual_arrival;
    if ((current.attribution_context || "") !== (baseline.attribution_context || "")) patch.attribution_context = current.attribution_context;
    if ((current.duty_exception_reason || "") !== (baseline.duty_exception_reason || "")) patch.duty_exception_reason = current.duty_exception_reason;
    if ((current.schedule_s_single_infraction ?? false) !== (baseline.schedule_s_single_infraction ?? false)) {
      patch.schedule_s_single_infraction = Boolean(current.schedule_s_single_infraction);
    }
    if (JSON.stringify(current.punctuality_review || {}) !== JSON.stringify(baseline.punctuality_review || {})) {
      patch.punctuality_review = current.punctuality_review;
    }
    if (dutyTripsSignature(current.trips) !== dutyTripsSignature(baseline.trips)) {
      patch.trips = renumberTrips(current.trips);
    }
    if (JSON.stringify(current.duty_dates || []) !== JSON.stringify(baseline.duty_dates || [])) {
      patch.duty_dates = current.duty_dates || [];
    }
    return patch;
  };

  const validateTrips = () => {
    const legs = (form.trips || []).filter(isDutyTripLeg);
    if (!legs.length) {
      toast.error("Add at least one trip leg");
      return false;
    }
    for (let i = 0; i < form.trips.length; i++) {
      const t = form.trips[i];
      if (!isDutyTripLeg(t)) {
        const st = String(t.start_time || "").trim();
        const et = String(t.end_time || "").trim();
        if (!st || !et) {
          toast.error(`Row ${i + 1}: set break start and end time`);
          return false;
        }
        const breakReason = String(t.break_label ?? "").trim();
        if (!breakReason) {
          toast.error(`Row ${i + 1}: enter a reason for the scheduled break`);
          return false;
        }
        continue;
      }
      if (tripStatusNeedsReason(t.trip_status)) {
        const code = normalizeCancelReasonCode(t.cancel_reason_code || "none");
        if (code === "none" || !code) {
          toast.error(`Trip leg ${i + 1}: choose a cancellation reason`);
          return false;
        }
      }
    }
    return true;
  };

  const hydrateFormFromDutyRecord = useCallback(
    (d, lists) => {
      const routeRows = lists?.routes ?? routes;
      const driverRows = lists?.drivers ?? drivers;
      const conductorRows = lists?.conductors ?? conductors;
      const tabsRaw = Array.isArray(d.duty_dates) ? d.duty_dates : [];
      const tabs = tabsRaw.map((t) => ({
        date: t.date,
        trips: renumberTrips(normalizeTripsFromApi(t.trips || [])),
        punctuality_scheduled_departure: t.punctuality_scheduled_departure || "",
        punctuality_scheduled_arrival: t.punctuality_scheduled_arrival || "",
        punctuality_actual_departure: t.punctuality_actual_departure || "",
        punctuality_actual_arrival: t.punctuality_actual_arrival || "",
      }));
      const activeDate = d.date || tabs[0]?.date || dateFromQuery || today;
      const activeTab = tabs.find((t) => t.date === activeDate);
      const raw = normalizeTripsFromApi(activeTab?.trips || d.trips);
      const trips = raw.length ? renumberTrips(raw) : defaultTripsForNewDuty();
      let rid = String(d.route_id ?? "").trim();
      if (!rid && (d.route_name || "").trim()) {
        const byName = routeRows.find((r) => (r.name || "").trim() === (d.route_name || "").trim());
        if (byName) rid = String(byName.route_id ?? "").trim();
      }
      if (rid) {
        const canon = routeRows.find((r) => String(r.route_id ?? "").trim() === rid);
        if (canon) rid = String(canon.route_id ?? "").trim();
        else {
          const byIdCi = routeRows.find((r) => String(r.route_id ?? "").trim().toLowerCase() === rid.toLowerCase());
          if (byIdCi) rid = String(byIdCi.route_id ?? "").trim();
        }
      }
      const routeIdSet = new Set(routeRows.map((r) => String(r.route_id ?? "").trim()));
      if (rid && !routeIdSet.has(rid)) {
        setRouteSelectExtra([
          {
            route_id: rid,
            name: (d.route_name || "").trim() || rid,
            origin: d.start_point || "",
            destination: d.end_point || "",
          },
        ]);
      } else {
        setRouteSelectExtra([]);
      }
      const resolveDriverLicense = (stored) => {
        const s = String(stored ?? "").trim();
        if (!s) return "";
        const exact = driverRows.find((dr) => String(dr.license_number) === s);
        if (exact) return String(exact.license_number);
        const byTrim = driverRows.find((dr) => String(dr.license_number ?? "").trim() === s);
        if (byTrim) return String(byTrim.license_number);
        return s;
      };
      const resolveConductorId = (stored) => {
        const s = String(stored ?? "").trim();
        if (!s) return "";
        const exact = conductorRows.find((c) => String(c.conductor_id) === s);
        if (exact) return String(exact.conductor_id);
        const byTrim = conductorRows.find((c) => String(c.conductor_id ?? "").trim() === s);
        if (byTrim) return String(byTrim.conductor_id);
        return s;
      };
      const nextTrips = deriveTripTerminalsForRoute(trips, d.start_point || "", d.end_point || "");
      const next = {
        template_id: String(d.template_id ?? "").trim(),
        driver_license: resolveDriverLicense(d.driver_license),
        conductor_id: resolveConductorId(d.conductor_id),
        bus_id: String(d.bus_id ?? "").trim(),
        route_id: rid,
        route_name: d.route_name,
        start_point: d.start_point,
        end_point: d.end_point,
        punctuality_scheduled_departure: activeTab?.punctuality_scheduled_departure || d.punctuality_scheduled_departure || "",
        punctuality_scheduled_arrival: activeTab?.punctuality_scheduled_arrival || d.punctuality_scheduled_arrival || "",
        punctuality_actual_departure: activeTab?.punctuality_actual_departure || d.punctuality_actual_departure || "",
        punctuality_actual_arrival: activeTab?.punctuality_actual_arrival || d.punctuality_actual_arrival || "",
        attribution_context: d.attribution_context || "",
        duty_exception_reason: d.duty_exception_reason || "",
        schedule_s_single_infraction: Boolean(d.schedule_s_single_infraction),
        punctuality_review: buildPunctualityReviewFromDuty(
          {
            punctuality_scheduled_departure: d.punctuality_scheduled_departure || "",
            punctuality_scheduled_arrival: d.punctuality_scheduled_arrival || "",
            punctuality_actual_departure: d.punctuality_actual_departure || "",
            punctuality_actual_arrival: d.punctuality_actual_arrival || "",
          },
          d.punctuality_review || {}
        ),
        date: activeDate,
        trips: nextTrips,
        duty_dates: tabs,
      };
      setForm(next);
      setForm(next);
      setEditBaseline(JSON.parse(JSON.stringify(next)));
      setEditing(d.id);
    },
    [routes, drivers, conductors, dateFromQuery]
  );

  useEffect(() => {
    if (isEdit && dutyData && routes.length && drivers.length && conductors.length) {
      hydrateFormFromDutyRecord(dutyData);
    }
  }, [isEdit, dutyData, routes, drivers, conductors, hydrateFormFromDutyRecord]);

  const selectRoute = (routeId) => {
    const rid = routeId != null && routeId !== "" ? String(routeId) : "";
    const r = routes.find((x) => String(x.route_id ?? "") === rid);
    setForm((prev) => {
      const routeStart = r?.origin || "";
      const routeEnd = r?.destination || "";
      const nextTrips = deriveTripTerminalsForRoute(prev.trips, routeStart, routeEnd);
      const first = firstTripLeg(nextTrips);
      const last = lastTripLeg(nextTrips);
      const nextForm = {
        ...prev,
        route_id: rid,
        route_name: r?.name || "",
        start_point: routeStart,
        end_point: routeEnd,
        trips: nextTrips,
        punctuality_scheduled_departure: prev.punctuality_scheduled_departure || (first?.start_time || ""),
        punctuality_scheduled_arrival: prev.punctuality_scheduled_arrival || (last?.end_time || ""),
        punctuality_actual_departure: prev.punctuality_actual_departure || (first?.actual_start_time || ""),
        punctuality_actual_arrival: prev.punctuality_actual_arrival || (last?.actual_end_time || ""),
      };
      nextForm.punctuality_review = buildPunctualityReviewFromDuty(nextForm, prev.punctuality_review);
      return nextForm;
    });
  };

  const syncDateTab = (next) => {
    const tab = {
      date: next.date,
      trips: renumberTrips(next.trips || []),
      punctuality_scheduled_departure: next.punctuality_scheduled_departure || "",
      punctuality_scheduled_arrival: next.punctuality_scheduled_arrival || "",
      punctuality_actual_departure: next.punctuality_actual_departure || "",
      punctuality_actual_arrival: next.punctuality_actual_arrival || "",
    };
    const others = (next.duty_dates || []).filter((t) => t.date !== next.date);
    return { ...next, duty_dates: [...others, tab].sort((a, b) => String(a.date).localeCompare(String(b.date))) };
  };

  const setActiveDate = (date) => {
    const target = String(date || "").trim();
    if (!target) return;
    setForm((prev) => {
      const tab = (prev.duty_dates || []).find((t) => t.date === target);
      if (tab) {
        return {
          ...prev,
          date: target,
          trips: renumberTrips(normalizeTripsFromApi(tab.trips || [])),
          punctuality_scheduled_departure: tab.punctuality_scheduled_departure || "",
          punctuality_scheduled_arrival: tab.punctuality_scheduled_arrival || "",
          punctuality_actual_departure: tab.punctuality_actual_departure || "",
          punctuality_actual_arrival: tab.punctuality_actual_arrival || "",
        };
      }
      return syncDateTab({
        ...prev,
        date: target,
        trips: defaultTripsForNewDuty(),
        punctuality_scheduled_departure: "",
        punctuality_scheduled_arrival: "",
        punctuality_actual_departure: "",
        punctuality_actual_arrival: "",
      });
    });
  };

  const updateTrip = (idx, field, value) => {
    const newTrips = [...form.trips];
    const cur = newTrips[idx];
    if (cur && !isDutyTripLeg(cur)) {
      const allowed = ["break_label", "start_time", "end_time", "start_point", "end_point"];
      if (!allowed.includes(field)) return;
    }
    let next = { ...newTrips[idx], [field]: value };
    if (field === "manual_status_pct") {
      next = { ...next, manual_status_pct: parseManualStatusPct(value) };
    }
    if (field === "trip_status") {
      if (value === "completed") return;
      if (!tripStatusNeedsReason(value)) {
        next = {
          ...next,
          cancel_reason_code: "none",
          cancel_reason_custom: "",
          add_to_incidents: false,
        };
      } else {
        next = { ...next, cancel_reason_code: normalizeCancelReasonCode(next.cancel_reason_code) };
      }
    }
    if (field === "cancel_reason_code") {
      const normalizedReason = normalizeCancelReasonCode(value);
      next = { ...next, cancel_reason_code: normalizedReason };
    }
    newTrips[idx] = next;
    const nextReview = buildPunctualityReviewFromDuty({ ...form, trips: newTrips }, form.punctuality_review);
    setForm(syncDateTab({ ...form, trips: newTrips, punctuality_review: nextReview }));
  };

  const updateDutyPunctuality = (field, value) => {
    setForm((prev) => {
      const nextTrips = [...(prev.trips || [])];
      const fi = nextTrips.findIndex(isDutyTripLeg);
      const li = nextTrips.map((x, j) => (isDutyTripLeg(x) ? j : -1)).filter((j) => j >= 0).pop();
      if (fi >= 0 && li != null && li >= 0) {
        const first = { ...nextTrips[fi] };
        const last = { ...nextTrips[li] };
        if (field === "punctuality_scheduled_departure") first.start_time = value;
        if (field === "punctuality_scheduled_arrival") last.end_time = value;
        if (field === "punctuality_actual_departure") first.actual_start_time = value;
        if (field === "punctuality_actual_arrival") last.actual_end_time = value;
        nextTrips[fi] = first;
        nextTrips[li] = last;
      }
      return syncDateTab({
        ...prev,
        [field]: value,
        trips: nextTrips,
        punctuality_review: buildPunctualityReviewFromDuty({ ...prev, [field]: value }, prev.punctuality_review),
      });
    });
  };

  const addTrip = () => {
    const i = form.trips.length;
    const nextTrips = [...form.trips, emptyTripRow(i)];
    const finalTrips = deriveTripTerminalsForRoute(renumberTrips(nextTrips), form.start_point, form.end_point);
    setForm(syncDateTab({ ...form, trips: finalTrips, punctuality_review: buildPunctualityReviewFromDuty(form, form.punctuality_review) }));
  };

  const addBreak = () => {
    const i = form.trips.length;
    const nextTrips = renumberTrips([...form.trips, emptyBreakRow(i)]);
    setForm(syncDateTab({ ...form, trips: nextTrips, punctuality_review: buildPunctualityReviewFromDuty(form, form.punctuality_review) }));
  };

  const removeTrip = (idx) => {
    if (!canRemoveDutyRow(form.trips, idx)) {
      toast.error("A duty must have at least one trip leg");
      return;
    }
    const next = form.trips.filter((_, j) => j !== idx);
    const finalTrips = deriveTripTerminalsForRoute(renumberTrips(next), form.start_point, form.end_point);
    setForm(syncDateTab({ ...form, trips: finalTrips, punctuality_review: buildPunctualityReviewFromDuty(form, form.punctuality_review) }));
  };

  const handleSave = async () => {
    try {
      const hasEnabled = (form.punctuality_review?.decisions || []).some((d) => d.enabled);
      if (hasEnabled && form.attribution_context !== "operator_fault") {
        toast.error("Set attribution to Operator fault to log punctuality infractions");
        return;
      }
      if (hasEnabled && !(form.duty_exception_reason || "").trim()) {
        toast.error("Enter duty exception reason when infraction toggles are enabled");
        return;
      }
      if (editing) {
        const patch = buildDutyPatch(editBaseline, form);
        if (!patch || Object.keys(patch).length === 0) {
          toast.info("No changes to save");
          return;
        }
        if (patch.trips != null && !validateTrips()) return;
        await updateDuty.mutateAsync({ id: editing, patch });
        toast.success("Duty updated");
        navigate("/duties");
        return;
      }
      if (!form.driver_license?.trim() || !form.conductor_id?.trim() || !form.bus_id?.trim() || !String(form.route_id || "").trim() || !form.date?.trim()) {
        toast.error("Please fill driver, conductor, bus, route, and date");
        return;
      }
      if (!validateTrips()) return;
      const payload = {
        ...syncDateTab(form),
        route_id: String(form.route_id),
        trips: renumberTrips(form.trips),
        punctuality_review: form.punctuality_review || { policy: "punctuality", violations: [], decisions: [] },
      };
      await createDuty.mutateAsync(payload);
      toast.success("Duty assigned");
      navigate("/duties");
    } catch (err) {
      toast.error(messageFromAxiosError(err, "Save failed"));
    }
  };

  const handleCancelRoundTrip = async () => {
    const anchor = roundTripCancelAnchor;
    if (!anchor) {
      toast.error("Cancel a leg and choose a reason first, with scheduled legs still below it.");
      return;
    }
    const { afterTripNumber, cancelReasonCode } = anchor;

    const applyToTrips = (trips) =>
      (trips || []).map((t, i) => {
        if (!isDutyTripLeg(t)) return t;
        const tn = Number(t.trip_number ?? i + 1);
        if (tn <= afterTripNumber) return t;
        if ((t.trip_status || "").toLowerCase() !== "scheduled") return t;
        return {
          ...t,
          trip_status: "cancelled",
          cancel_reason_code: cancelReasonCode,
          cancel_reason_custom: "",
        };
      });

    try {
      if (editing) {
        await cancelFollowingTrips.mutateAsync({
          id: editing,
          payload: {
            after_trip_number: afterTripNumber,
            cancel_reason_code: cancelReasonCode,
            cancel_reason_custom: "",
          }
        });
      }
      const nextTrips = applyToTrips(form.trips);
      const updated = {
        ...form,
        trips: nextTrips,
        punctuality_review: buildPunctualityReviewFromDuty({ ...form, trips: nextTrips }, form.punctuality_review),
      };
      setForm(updated);
      if (editing) {
        setEditBaseline(JSON.parse(JSON.stringify(updated)));
        await loadDutyDetail();
      }
      toast.success("Remaining legs cancelled with the same reason");
    } catch (err) {
      toast.error(messageFromAxiosError(err, "Cancellation failed"));
    }
  };

  const title = isEdit ? "Edit duty" : "Assign duty";
  const description = "Choose route, then trips and times. Trip IDs appear after save.";

  const breadcrumbs = [
    { label: "Operations", to: "/dashboard" },
    { label: "Duty Roster", to: "/duties" },
    { label: isEdit ? `Edit · ${dutyId || ""}` : "Assign duty" },
  ];

  if (fetchError && !pageLoading && isEdit) {
    return (
      <div data-testid="duty-assign-page" className="w-full max-w-none">
        <HeaderSecondary title={title} description={description} breadcrumbs={breadcrumbs} />
        <AsyncPanel error={fetchError} onRetry={() => loadDutyDetail()} />
      </div>
    );
  }

  return (
    <div data-testid="duty-assign-page" className="w-full max-w-none">
      <HeaderSecondary
        title={title}
        description={description}
        breadcrumbs={breadcrumbs}
        actions={
          <Button type="button" variant="outline" className="rounded-lg border-gray-300" onClick={() => navigate("/duties")} data-testid="duty-assign-back">
            <ArrowLeft size={14} className="mr-1.5" /> Back to roster
          </Button>
        }
      />

      {pageLoading ? (
        <AsyncPanel loading minHeight="min-h-[240px]" />
      ) : (
        <div className="w-full rounded-xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6">
          <DutyFormBody
            form={form}
            setForm={setForm}
            editing={editing}
            drivers={drivers}
            conductors={conductors}
            buses={buses}
            routesForSelect={routesForSelect}
            selectedRoute={selectedRoute}
            isRtcFault={isRtcFault}
            roundTripCancelAnchor={roundTripCancelAnchor}
            setActiveDate={setActiveDate}
            selectRoute={selectRoute}
            updateDutyPunctuality={updateDutyPunctuality}
            updateTrip={updateTrip}
            addTrip={addTrip}
            addBreak={addBreak}
            removeTrip={removeTrip}
            canRemoveRow={canRemoveDutyRow}
            handleSave={handleSave}
            handleCancelRoundTrip={handleCancelRoundTrip}
          />
        </div>
      )}
    </div>
  );
}
