import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import API, { formatApiError, buildQuery, unwrapListResponse } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import TablePaginationBar from "../components/TablePaginationBar";
import TableLoadRows from "../components/TableLoadRows";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../components/ui/hover-card";
import { Search, ExternalLink, Info, HelpCircle } from "lucide-react";

const catColors = {
  A: "bg-gray-100 text-gray-700", B: "bg-blue-100 text-blue-700",
  C: "bg-yellow-100 text-yellow-700", D: "bg-orange-100 text-orange-700",
  E: "bg-red-100 text-red-700", F: "bg-red-200 text-red-800",
  G: "bg-red-300 text-red-900"
};

const categories = [
  { cat: 'A', label: 'Minor / Documentation', color: 'bg-gray-100' },
  { cat: 'B', label: 'Operational Sync', color: 'bg-blue-100' },
  { cat: 'C', label: 'Major Maintenance', color: 'bg-yellow-100' },
  { cat: 'D', label: 'Serious Violation', color: 'bg-orange-100' },
  { cat: 'E', label: 'Critical Safety', color: 'bg-red-600 text-white' },
  { cat: 'F', label: 'Severe Breakdown', color: 'bg-red-800 text-white' },
  { cat: 'G', label: 'Fatal Accident', color: 'bg-black text-white' }
];

function capRuleLabel(row) {
  return row?.is_capped_non_safety ? "Capped (5%)" : "Non-capped";
}

const scheduleGroupStyles = {
  safety: "bg-red-50 text-red-800 border-red-100",
  operations: "bg-blue-50 text-blue-800 border-blue-100",
  quality: "bg-violet-50 text-violet-800 border-violet-100",
};

/** Schedule-S grouping (safety / operations / quality). API: schedule_group; legacy: pillar. */
function scheduleGroupKey(row) {
  return String(row?.schedule_group || row?.pillar || "").toLowerCase();
}

function scheduleGroupLabel(row) {
  const p = scheduleGroupKey(row);
  if (p === "safety") return "Safety";
  if (p === "quality") return "Quality";
  if (p === "operations") return "Operations";
  return "—";
}

function escalationLabel(row) {
  const cat = String(row?.category || "").toUpperCase();
  if (!row?.repeat_escalation) return "None";
  if (["A", "B", "C", "D", "E"].includes(cat)) return "Next slab if not rectified (max Rs.3,000)";
  return "Next slab if not rectified";
}

function has20KmRule(row) {
  return row?.km_deduction_rule === "20_km_x_pk_rate" || ["O01", "O03"].includes(String(row?.code || "").toUpperCase());
}

export default function InfractionsPage() {
  const [catalogue, setCatalogue] = useState([]);
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: 30 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await API.get(Endpoints.infractions.catalogue(), {
        params: buildQuery({ page, limit, search: catalogueSearch }),
      });
      const cu = unwrapListResponse(data);
      setCatalogue(cu.items);
      setMeta({ total: cu.total, pages: cu.pages, limit: cu.limit });
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || err.message || "Failed to load catalogue");
      setCatalogue([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit, catalogueSearch]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [catalogueSearch, limit]);

  return (
    <div data-testid="infractions-page" className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black tracking-tight text-gray-900">Infraction Catalogue</h1>
            <HoverCard openDelay={0} closeDelay={100}>
              <HoverCardTrigger asChild>
                <div className="p-1.5 bg-gray-100 rounded-full cursor-help text-gray-400 hover:text-gray-900 hover:bg-gray-200 transition-all">
                  <HelpCircle size={18} />
                </div>
              </HoverCardTrigger>
              <HoverCardContent className="w-80 p-0 border-none shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-4 bg-gray-900 text-white font-black text-[10px] uppercase tracking-[0.2em]">
                  Schedule-S Category Guide
                </div>
                <div className="p-4 bg-white space-y-3">
                  {categories.map((item) => (
                    <div key={item.cat} className="flex items-center gap-3">
                      <Badge className={`${item.color} w-6 h-6 p-0 flex items-center justify-center font-black border-none ring-1 ring-black/5`}>{item.cat}</Badge>
                      <span className="text-[11px] font-bold text-gray-600">{item.label}</span>
                    </div>
                  ))}
                  <div className="mt-4 pt-3 border-t border-gray-100 text-[10px] text-gray-400 font-medium leading-relaxed">
                    Categories define the severity and deduction slab as per the concession agreement.
                  </div>
                </div>
              </HoverCardContent>
            </HoverCard>
          </div>
          <p className="text-gray-500 max-w-2xl leading-relaxed">
            Reference for Schedule-S penalty codes, amounts, and escalation rules.
            Active penalties are now managed directly within <Link to="/incidents" className="text-[#C8102E] font-bold hover:underline inline-flex items-center gap-1 mx-1">Incidents <ExternalLink size={12}/></Link>.
          </p>
        </div>
      </div>

      <Card className="border-amber-100 bg-amber-50/50 shadow-sm rounded-2xl p-4 flex items-start gap-3">
        <Info className="text-amber-600 shrink-0 mt-0.5" size={18} />
        <div className="space-y-1">
          <h4 className="text-xs font-black uppercase tracking-widest text-amber-900">Operational Notice</h4>
          <p className="text-xs text-amber-800 leading-relaxed font-medium">
            Infraction amounts are fixed at the time of incident reporting. Unrectified violations may trigger escalation 
            to the next penalty slab if non-compliance continues beyond the defined resolution period.
          </p>
        </div>
      </Card>

      <Card className="border-gray-200 shadow-xl overflow-hidden rounded-2xl bg-white">
        <div className="p-4 bg-gray-50/50 border-b flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:max-w-md">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={catalogueSearch}
              onChange={(e) => setCatalogueSearch(e.target.value)}
              placeholder="Search code or description..."
              className="pl-10 h-10 bg-white border-gray-200 focus-visible:ring-[#C8102E] rounded-xl"
              data-testid="infractions-catalogue-search"
            />
          </div>
          <div className="flex items-center gap-2 text-[10px] uppercase font-black tracking-widest text-gray-400">
            <Info size={14} className="text-blue-500" /> Page {page} of {meta.pages}
          </div>
        </div>
        
        <CardContent className="p-0">
          <Table className="text-[12px]">
            <TableHeader>
              <TableRow className="bg-gray-50/50 border-b table-header">
                <TableHead className="w-[100px] font-black uppercase text-[10px] tracking-widest px-6">Code</TableHead>
                <TableHead className="w-[60px] font-black uppercase text-[10px] tracking-widest">Category</TableHead>
                <TableHead className="min-w-[400px] font-black uppercase text-[10px] tracking-widest">Description</TableHead>
                <TableHead className="text-right font-black uppercase text-[10px] tracking-widest">Amount</TableHead>
                <TableHead className="font-black uppercase text-[10px] tracking-widest pl-6 min-w-[120px]">
                  Group
                </TableHead>
                <TableHead className="text-right font-black uppercase text-[10px] tracking-widest">Resolution Days</TableHead>
                <TableHead className="font-black uppercase text-[10px] tracking-widest pl-4">Capping Rule</TableHead>
                <TableHead className="font-black uppercase text-[10px] tracking-widest">Escalation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableLoadRows
                colSpan={8}
                loading={loading}
                error={error}
                onRetry={load}
                isEmpty={catalogue.length === 0}
                emptyMessage="No catalogue entries found"
              >
                {catalogue.map((c) => (
                  <TableRow key={c.id} className="hover:bg-gray-50 transition-colors border-b last:border-0" data-testid={`cat-row-${c.code}`}>
                    <TableCell className="font-mono font-bold text-[#C8102E] px-6 text-[12px]">{c.code}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${catColors[c.category] || "bg-gray-100"} border-none text-[10px] font-black h-5 px-2`}>
                        {c.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[12px] font-medium text-gray-700 py-4 leading-relaxed pr-8 whitespace-normal break-words">
                      {c.description}
                    </TableCell>
                    <TableCell className="text-right pr-4 text-[12px]">
                      {has20KmRule(c) ? (
                        <div className="inline-flex flex-col items-end leading-tight">
                          <span className="font-mono font-black text-gray-900">20 km x PK rate</span>
                          <span className="text-[10px] text-amber-700 font-semibold">16.6 deduction rule</span>
                        </div>
                      ) : (
                        <span className="font-mono font-black text-gray-900">₹{c.amount?.toLocaleString()}</span>
                      )}
                    </TableCell>
                    <TableCell className="pl-6">
                      {scheduleGroupKey(c) ? (
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-black h-5 uppercase border ${scheduleGroupStyles[scheduleGroupKey(c)] || "bg-gray-50 text-gray-600 border-gray-100"}`}
                        >
                          {scheduleGroupLabel(c)}
                        </Badge>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-gray-500 whitespace-nowrap text-[12px]">{c.resolve_days ?? "—"}d</TableCell>
                    <TableCell className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter pl-8 font-mono whitespace-normal">{capRuleLabel(c)}</TableCell>
                    <TableCell className="text-[10px] font-medium text-gray-600 whitespace-normal">{escalationLabel(c)}</TableCell>
                  </TableRow>
                ))}
              </TableLoadRows>
            </TableBody>
          </Table>
          <div className="bg-gray-50/30">
            <TablePaginationBar
              page={page}
              pages={meta.pages}
              total={meta.total}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={setLimit}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
