import { Fragment, useMemo, useRef } from "react";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  TRIP_STATUS_OPTIONS,
  CANCEL_REASON_GROUPS,
  tripStatusNeedsReason,
  roundTripCompletionPct,
  scheduleSOCodeHintFromManualPct,
  isDeductibleCancelCode,
  isDutyTripLeg,
} from "@/features/duty/lib/dutyTrips";
import { breakRowPrimaryLabel, buildPunctualityReviewFromDuty } from "@/features/duty/lib/dutyFormHelpers";

/**
 * Duty assign/edit form fields — same layout as the former modal body (max-width comes from parent).
 */
export default function DutyFormBody({
  form,
  setForm,
  editing,
  drivers,
  conductors,
  buses,
  routesForSelect,
  selectedRoute,
  isRtcFault,
  roundTripCancelAnchor,
  setActiveDate,
  selectRoute,
  updateDutyPunctuality,
  updateTrip,
  addTrip,
  addBreak,
  removeTrip,
  canRemoveRow,
  handleSave,
  handleCancelRoundTrip,
}) {
  const selectDateInputRef = useRef(null);
  const formatDateTabLabel = (isoDate) => {
    const s = String(isoDate || "").trim();
    if (!s) return "";
    const d = new Date(`${s}T00:00:00`);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  };
  /** First trip leg with a deductible cancel — same basis as the former Schedule S card. */
  const scheduleSToggleTripIndex = useMemo(
    () =>
      form.trips.findIndex(
        (trip) =>
          isDutyTripLeg(trip) &&
          tripStatusNeedsReason(trip.trip_status) &&
          isDeductibleCancelCode(trip.cancel_reason_code)
      ),
    [form.trips]
  );

  /** Recompute from current times so the review block never shows unless rules actually flag a variance. */
  const punctualityReviewLive = useMemo(
    () => buildPunctualityReviewFromDuty(form, form.punctuality_review || {}),
    // buildPunctualityReviewFromDuty only reads duty punctuality fields + decisions; avoid recomputing on unrelated form edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- punctuality_* + punctuality_review only
    [
      form.punctuality_scheduled_departure,
      form.punctuality_scheduled_arrival,
      form.punctuality_actual_departure,
      form.punctuality_actual_arrival,
      form.punctuality_review,
    ]
  );
  const hasPunctualityViolations = (punctualityReviewLive.violations || []).length > 0;

  /** 12px typography and controls across this form (overrides Input/Label/Button/Select defaults). */
  const formText = "text-[12px] leading-normal [&_label]:!text-[12px] [&_input]:!text-[12px] md:[&_input]:!text-[12px] [&_[role=combobox]]:!text-[12px] [&_button]:!text-[12px]";
  const selectContent12 = "[&_[role=option]]:!text-[12px] [&_[role=group]]:!text-[12px]";

  return (
    <div className={`space-y-4 ${formText}`}>
      <div className="space-y-2 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap gap-2">
          {(form.duty_dates || []).map((t) => (
            <Button
              key={t.date}
              type="button"
              variant={String(form.date) === String(t.date) ? "default" : "outline"}
              className="h-8 text-[12px]"
              onClick={() => setActiveDate(t.date)}
            >
              <CalendarDays size={12} className="mr-1.5" />
              {formatDateTabLabel(t.date)}
            </Button>
          ))}
          <label className="inline-flex">
            <input
              ref={selectDateInputRef}
              type="date"
              className="sr-only"
              value={form.date || ""}
              onChange={(e) => setActiveDate(e.target.value)}
            />
            <span
              className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-[12px] font-medium cursor-pointer hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const el = selectDateInputRef.current;
                if (!el) return;
                if (typeof el.showPicker === "function") el.showPicker();
                else el.click();
              }}
            >
              <CalendarDays size={12} className="mr-1.5" />
              Select date
            </span>
          </label>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Driver</Label>
          <Select value={form.driver_license ? String(form.driver_license) : "__none"} onValueChange={(v) => setForm((prev) => ({ ...prev, driver_license: v === "__none" ? "" : v }))}>
            <SelectTrigger className="h-8" data-testid="duty-driver-select">
              <SelectValue placeholder="Select driver" />
            </SelectTrigger>
            <SelectContent className={selectContent12}>
              <SelectItem value="__none">Select driver</SelectItem>
              {drivers.map((dr) => <SelectItem key={dr.license_number} value={String(dr.license_number)}>{dr.name} ({dr.license_number})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Conductor</Label>
          <Select value={form.conductor_id ? String(form.conductor_id) : "__none"} onValueChange={(v) => setForm((prev) => ({ ...prev, conductor_id: v === "__none" ? "" : v }))}>
            <SelectTrigger className="h-8" data-testid="duty-conductor-select">
              <SelectValue placeholder="Select conductor" />
            </SelectTrigger>
            <SelectContent className={selectContent12}>
              <SelectItem value="__none">Select conductor</SelectItem>
              {conductors.map((c) => <SelectItem key={c.conductor_id} value={String(c.conductor_id)}>{c.name} ({c.conductor_id})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Bus</Label>
          <Select value={form.bus_id ? String(form.bus_id) : "__none"} onValueChange={(v) => setForm((prev) => ({ ...prev, bus_id: v === "__none" ? "" : v }))}>
            <SelectTrigger className="h-8" data-testid="duty-bus-select">
              <SelectValue placeholder="Select bus" />
            </SelectTrigger>
            <SelectContent className={selectContent12}>
              <SelectItem value="__none">Select bus</SelectItem>
              {buses.map((b) => <SelectItem key={b.bus_id} value={b.bus_id}>{b.bus_id} ({b.depot})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Date</Label>
          <Input type="date" className="h-8" value={form.date} disabled data-testid="duty-date" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Route</Label>
        <Select value={form.route_id ? String(form.route_id).trim() : "__none"} onValueChange={(v) => selectRoute(v === "__none" ? "" : v)}>
          <SelectTrigger className="h-8" data-testid="duty-route-select">
            <SelectValue placeholder="Select route" />
          </SelectTrigger>
          <SelectContent className={selectContent12}>
            <SelectItem value="__none">Select route</SelectItem>
            {routesForSelect.map((r) => (
              <SelectItem key={String(r.route_id)} value={String(r.route_id).trim()}>
                {r.route_id} — {r.name}{r.origin || r.destination ? ` (${r.origin || "—"} → ${r.destination || "—"})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Starting point</Label>
          <Input className="h-8" value={form.start_point} readOnly disabled placeholder="Auto-filled from route" data-testid="duty-start-point" />
        </div>
        <div className="space-y-2">
          <Label>Ending point</Label>
          <Input className="h-8" value={form.end_point} readOnly disabled placeholder="Auto-filled from route" data-testid="duty-end-point" />
        </div>
      </div>
      {String(form.route_id || "").trim() ? (
        <p className="text-[12px] text-muted-foreground rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
          Route distance:{" "}
          {selectedRoute != null && selectedRoute.distance_km != null && selectedRoute.distance_km !== ""
            ? `${Number(selectedRoute.distance_km).toLocaleString("en-IN", { maximumFractionDigits: 1 })} km`
            : "—"}
          {form.trips?.length ? (
            <>
              {" · "}
              Completed legs:{" "}
              <span className="font-mono text-slate-700">{roundTripCompletionPct(form.trips) != null ? `${roundTripCompletionPct(form.trips)}%` : "—"}</span>
            </>
          ) : null}
        </p>
      ) : null}
      <div className="border rounded-md p-3 sm:p-4 bg-gray-50 space-y-4">
        <div className="space-y-3">
          <Label className="text-[12px] font-semibold">Punctuality</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[12px] text-gray-600">Scheduled departure</Label>
              <Input type="time" className="h-8" value={form.punctuality_scheduled_departure || ""} onChange={(e) => updateDutyPunctuality("punctuality_scheduled_departure", e.target.value)} data-testid="duty-punctuality-sched-dep" />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px] text-gray-600">Scheduled arrival</Label>
              <Input type="time" className="h-8" value={form.punctuality_scheduled_arrival || ""} onChange={(e) => updateDutyPunctuality("punctuality_scheduled_arrival", e.target.value)} data-testid="duty-punctuality-sched-arr" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[12px] text-gray-600">Actual departure</Label>
              <Input type="time" className="h-8" value={form.punctuality_actual_departure || ""} onChange={(e) => updateDutyPunctuality("punctuality_actual_departure", e.target.value)} data-testid="duty-punctuality-actual-dep" />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px] text-gray-600">Actual arrival</Label>
              <Input type="time" className="h-8" value={form.punctuality_actual_arrival || ""} onChange={(e) => updateDutyPunctuality("punctuality_actual_arrival", e.target.value)} data-testid="duty-punctuality-actual-arr" />
            </div>
          </div>
        </div>

        {hasPunctualityViolations ? (
          <>
            <div className="space-y-3 pt-2 border-t border-slate-200/90">
              <Label className="text-[12px] font-semibold">Attribution and exception</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[12px] text-gray-600">Attribution context</Label>
                  <Select
                    value={form.attribution_context || "__none"}
                    onValueChange={(v) => {
                      const ctx = v === "__none" ? "" : v;
                      if (ctx === "rtc_fault") {
                        setForm((prev) => ({
                          ...prev,
                          attribution_context: ctx,
                          schedule_s_single_infraction: false,
                          punctuality_review: {
                            ...(prev.punctuality_review || {}),
                            decisions: (prev.punctuality_review?.decisions || []).map((d) => ({ ...d, enabled: false })),
                          },
                          trips: (prev.trips || []).map((t) => ({ ...t, add_to_incidents: false })),
                        }));
                      } else {
                        setForm((prev) => ({ ...prev, attribution_context: ctx }));
                      }
                    }}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select context" />
                    </SelectTrigger>
                    <SelectContent className={selectContent12}>
                      <SelectItem value="__none">—</SelectItem>
                      <SelectItem value="rtc_fault">RTC fault</SelectItem>
                      <SelectItem value="operator_fault">Operator fault</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px] text-gray-600">Duty exception reason</Label>
                  <Input
                    className="h-8"
                    value={form.duty_exception_reason || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, duty_exception_reason: e.target.value }))}
                    placeholder="Road works, diversion, authority instruction, etc."
                  />
                </div>
              </div>
              {isRtcFault ? (
                <p className="text-[12px] text-muted-foreground rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2">
                  RTC fault: no incidents. Pick <span className="font-medium">Operator fault</span> to log them.
                </p>
              ) : null}
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-200/90">
              <Label className="text-[12px] font-semibold">Punctuality review</Label>
              <div className="space-y-3">
                {(punctualityReviewLive.violations || []).map((v) => {
                  const decision = (punctualityReviewLive.decisions || []).find((d) => d.rule_key === v.rule_key) || { enabled: false, reason: "" };
                  return (
                    <div key={v.rule_key} className="rounded-md border border-amber-200/90 bg-amber-50/80 p-3 space-y-2">
                      <p className="text-[12px] font-medium text-amber-900 leading-snug">
                        Trip : {v.message}
                      </p>
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-[12px] text-gray-700">Include as infraction</Label>
                        <Switch
                          checked={Boolean(decision.enabled)}
                          disabled={isRtcFault}
                          onCheckedChange={(checked) => {
                            const nextDecisions = (form.punctuality_review?.decisions || []).map((d) => (d.rule_key === v.rule_key ? { ...d, enabled: checked } : d));
                            setForm({
                              ...form,
                              punctuality_review: { ...(form.punctuality_review || {}), decisions: nextDecisions },
                            });
                          }}
                        />
                      </div>
                      {decision.enabled ? (
                        <div>
                          <Label className="text-[12px] text-gray-600">Reason</Label>
                          <Input
                            className="mt-1 h-8"
                            value={decision.reason || ""}
                            onChange={(e) => {
                              const nextDecisions = (form.punctuality_review?.decisions || []).map((d) => (d.rule_key === v.rule_key ? { ...d, reason: e.target.value } : d));
                              setForm({
                                ...form,
                                punctuality_review: { ...(form.punctuality_review || {}), decisions: nextDecisions },
                              });
                            }}
                            placeholder="Reason for allowing/blocking this infraction"
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="border-t pt-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-[12px] font-semibold">Trips and scheduled breaks</Label>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {roundTripCancelAnchor ? (
              <Button type="button" variant="outline" size="sm" className="h-8 border-[#C8102E] text-[12px] text-[#C8102E] hover:bg-red-50" onClick={handleCancelRoundTrip} data-testid="cancel-round-trip-btn">
                Cancel round trip
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={addTrip} className="h-8 text-[12px]" data-testid="duty-add-trip">
              <Plus size={14} className="mr-1" /> Add trip
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={addBreak} className="h-8 text-[12px]" data-testid="duty-add-break">
              <Plus size={14} className="mr-1" /> Add break
            </Button>
          </div>
        </div>
        <p className="text-[12px] text-muted-foreground px-0.5">Trip legs: not 100% → O13 / O14 / O15 bands. Break rows are driver lunch/rest windows and do not count as trip legs.</p>
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <Table className="text-[12px]">
            <TableHeader>
              <TableRow className="table-header">
                <TableHead className="w-10">#</TableHead>
                <TableHead className="whitespace-nowrap min-w-[100px]">Trip ID</TableHead>
                <TableHead className="whitespace-nowrap">Start point</TableHead>
                <TableHead className="whitespace-nowrap">End point</TableHead>
                <TableHead className="whitespace-nowrap">Start time</TableHead>
                <TableHead className="whitespace-nowrap">End time</TableHead>
                <TableHead className="whitespace-nowrap min-w-[88px] text-[12px]">Trip Status (%)</TableHead>
                <TableHead className="whitespace-nowrap min-w-[100px]">Status</TableHead>
                <TableHead className="whitespace-nowrap min-w-[120px]">Cancellation reason</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {form.trips.map((t, idx) => {
                if (!isDutyTripLeg(t)) {
                  return (
                    <TableRow key={`break-${idx}`} className="align-top bg-slate-50/60">
                      <TableCell className="font-mono text-[12px] pt-3">{idx + 1}</TableCell>
                      <TableCell className="p-1 pt-2.5 text-[12px] text-muted-foreground">—</TableCell>
                      <TableCell className="p-1 pt-2.5 text-[12px] text-muted-foreground tabular-nums" colSpan={2}>
                        {breakRowPrimaryLabel(t.start_time, t.end_time)}
                      </TableCell>
                      <TableCell className="p-1">
                        <Input type="time" className="h-8 text-[12px] w-[128px] min-w-[128px] max-w-[128px]" value={t.start_time || ""} onChange={(e) => updateTrip(idx, "start_time", e.target.value)} data-testid={`break-${idx}-start`} />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input type="time" className="h-8 text-[12px] w-[128px] min-w-[128px] max-w-[128px]" value={t.end_time || ""} onChange={(e) => updateTrip(idx, "end_time", e.target.value)} data-testid={`break-${idx}-end`} />
                      </TableCell>
                      <TableCell className="p-1 text-[12px] text-muted-foreground pt-3">—</TableCell>
                      <TableCell className="p-1 pt-2.5 text-[12px] text-muted-foreground">—</TableCell>
                      <TableCell className="p-1 min-w-[120px]">
                        <Input
                          className="h-8 text-[12px]"
                          value={t.break_label ?? ""}
                          onChange={(e) => updateTrip(idx, "break_label", e.target.value)}
                          placeholder="Reason (e.g. lunch)"
                          maxLength={64}
                          data-testid={`break-${idx}-reason`}
                        />
                      </TableCell>
                      <TableCell className="p-1 pt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600"
                          onClick={() => removeTrip(idx)}
                          disabled={!canRemoveRow(form.trips, idx)}
                          data-testid={`break-${idx}-remove`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                }
                const oBand = scheduleSOCodeHintFromManualPct(t.manual_status_pct);
                const status = String(t.trip_status || "scheduled").toLowerCase();
                const showApplicableInfraction = Boolean(oBand) && status === "cancelled";
                return (
                  <Fragment key={`trip-block-${idx}`}>
                    <TableRow className="align-top">
                      <TableCell className="font-mono text-[12px] pt-3">{idx + 1}</TableCell>
                      <TableCell className="p-1 pt-2.5 align-top min-w-0">
                        <span
                          className={`block text-[12px] font-mono px-1 break-all whitespace-normal ${t.trip_id ? "text-gray-800" : "text-gray-400"}`}
                          title={t.trip_id || ""}
                          data-testid={`trip-${idx}-id-readonly`}
                        >
                          {t.trip_id && String(t.trip_id).trim() ? t.trip_id : "-"}
                        </span>
                      </TableCell>
                      <TableCell className="p-1">
                        <Input className="h-8 text-[12px] w-[150px]" value={t.start_point || ""} onChange={(e) => updateTrip(idx, "start_point", e.target.value)} data-testid={`trip-${idx}-start-point`} />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input className="h-8 text-[12px] w-[150px]" value={t.end_point || ""} onChange={(e) => updateTrip(idx, "end_point", e.target.value)} data-testid={`trip-${idx}-end-point`} />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input type="time" className="h-8 text-[12px] w-[128px] min-w-[128px] max-w-[128px]" value={t.start_time || ""} onChange={(e) => updateTrip(idx, "start_time", e.target.value)} data-testid={`trip-${idx}-sched-start`} />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input type="time" className="h-8 text-[12px] w-[128px] min-w-[128px] max-w-[128px]" value={t.end_time || ""} onChange={(e) => updateTrip(idx, "end_time", e.target.value)} data-testid={`trip-${idx}-sched-end`} />
                      </TableCell>
                      <TableCell className="p-1 w-[88px] align-top">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          className="h-8 text-[12px] font-mono tabular-nums"
                          placeholder="—"
                          value={t.manual_status_pct === null || t.manual_status_pct === undefined ? "" : String(t.manual_status_pct)}
                          onChange={(e) => updateTrip(idx, "manual_status_pct", e.target.value)}
                          data-testid={`trip-${idx}-manual-pct`}
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <Select value={t.trip_status || "scheduled"} onValueChange={(v) => updateTrip(idx, "trip_status", v)}>
                          <SelectTrigger className="h-8 text-[12px] min-w-[100px]" data-testid={`trip-${idx}-status`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className={selectContent12}>
                            {TRIP_STATUS_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value} disabled={o.value === "completed"}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="p-1">
                        <Select value={t.cancel_reason_code || "none"} onValueChange={(v) => updateTrip(idx, "cancel_reason_code", v)} disabled={!tripStatusNeedsReason(t.trip_status)}>
                          <SelectTrigger className="h-8 text-[12px] min-w-[120px]" data-testid={`trip-${idx}-reason`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className={selectContent12}>
                            {CANCEL_REASON_GROUPS.map((g) => (
                              <SelectGroup key={g.label}>
                                <SelectLabel className="text-[12px]">{g.label}</SelectLabel>
                                {g.options.map((o) => (
                                  <SelectItem key={`${g.label}-${o.value}`} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="p-1 pt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600"
                          onClick={() => removeTrip(idx)}
                          disabled={!canRemoveRow(form.trips, idx)}
                          data-testid={`trip-${idx}-remove`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {showApplicableInfraction ? (
                      <TableRow key={`${idx}-o-band`} className="bg-slate-50/70 border-t border-slate-100">
                        <TableCell colSpan={10} className="py-2 px-3 text-[12px]">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <span className="text-muted-foreground">Applicable infraction: </span>
                              <span className="font-mono font-medium text-slate-800" data-testid={`trip-${idx}-o-band`}>
                                {oBand}
                              </span>
                            </div>
                            {scheduleSToggleTripIndex === idx ? (
                              <div className="flex items-center gap-2 shrink-0">
                                <Label htmlFor={`duty-schedule-s-${idx}`} className="text-[12px] text-muted-foreground whitespace-nowrap cursor-pointer">
                                  Add to Incidents

                                </Label>
                                <Switch
                                  id={`duty-schedule-s-${idx}`}
                                  checked={Boolean(form.schedule_s_single_infraction)}
                                  disabled={isRtcFault}
                                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, schedule_s_single_infraction: Boolean(checked) }))}
                                  data-testid="duty-schedule-s-single-infraction"
                                />
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {scheduleSToggleTripIndex === idx && !showApplicableInfraction ? (
                      <TableRow key={`${idx}-schedule-s-only`} className="bg-slate-50/70 border-t border-slate-100">
                        <TableCell colSpan={10} className="py-2 px-3 text-[12px]">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-muted-foreground">Deductible cancellation on this leg — use one Schedule S row for the duty if needed.</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <Label htmlFor={`duty-schedule-s-fallback-${idx}`} className="text-[12px] text-muted-foreground whitespace-nowrap cursor-pointer">
                                Add to Incidents

                              </Label>
                              <Switch
                                id={`duty-schedule-s-fallback-${idx}`}
                                checked={Boolean(form.schedule_s_single_infraction)}
                                disabled={isRtcFault}
                                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, schedule_s_single_infraction: Boolean(checked) }))}
                                data-testid="duty-schedule-s-single-infraction-fallback"
                              />
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <Button onClick={handleSave} className="w-full text-[12px] bg-[#C8102E] hover:bg-[#A50E25]" data-testid="duty-save-btn">
          {editing ? "Update duty" : "Assign duty"}
        </Button>
      </div>
    </div>
  );
}
