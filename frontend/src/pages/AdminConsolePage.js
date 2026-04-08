import { useState, useEffect, useCallback, useMemo } from "react";
import API, { formatApiError, unwrapListResponse, messageFromAxiosError } from "../lib/api";
import { Endpoints } from "../lib/endpoints";
import AsyncPanel from "../components/AsyncPanel";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Users, Shield, Search, KeyRound } from "lucide-react";
import { Checkbox } from "../components/ui/checkbox";
import { toast } from "sonner";

const ROLE_STYLES = {
  admin: "bg-red-50 text-red-700 border-red-200",
  management: "bg-indigo-50 text-indigo-800 border-indigo-200",
  depot: "bg-sky-50 text-sky-800 border-sky-200",
  vendor: "bg-amber-50 text-amber-800 border-amber-200",
};

const PERM_GROUP_ORDER = ["Overview", "Operations", "Master data", "Finance", "Reports", "Admin", "Other"];
const PERM_ACTION_KEYS = ["read", "create", "update", "delete"];
const PERM_ACTION_LABELS = { read: "View", create: "Create", update: "Edit", delete: "Delete" };

function parsePermissionId(id) {
  const parts = id.split(".");
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && PERM_ACTION_KEYS.includes(last)) {
    return { resourceKey: parts.slice(0, -1).join("."), action: last };
  }
  return { resourceKey: id, action: "read" };
}

function buildPermissionTableRows(perms) {
  const map = new Map();
  for (const p of perms) {
    const { resourceKey, action } = parsePermissionId(p.id);
    if (!map.has(resourceKey)) {
      const title = p.label.includes(" — ") ? p.label.split(" — ")[0].trim() : p.label;
      map.set(resourceKey, { title, cells: {} });
    }
    map.get(resourceKey).cells[action] = p.id;
  }
  return [...map.entries()]
    .sort((a, b) => a[1].title.localeCompare(b[1].title))
    .map(([resourceKey, row]) => ({ resourceKey, ...row }));
}

export default function AdminConsolePage() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [permCatalog, setPermCatalog] = useState([]);
  const [permMatrix, setPermMatrix] = useState({});
  const [permRole, setPermRole] = useState("admin");
  const [permDraft, setPermDraft] = useState([]);
  const [permSaving, setPermSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [uRes, rRes, cRes, mRes] = await Promise.all([
        API.get(Endpoints.admin.users(), { params: { page: 1, limit: 100 } }),
        API.get(Endpoints.admin.roles()),
        API.get(Endpoints.admin.permissionsCatalog()),
        API.get(Endpoints.admin.permissionsMatrix()),
      ]);
      const u = unwrapListResponse(uRes.data);
      setUsers(u.items);
      setTotal(u.total);
      setRoles(Array.isArray(rRes.data) ? rRes.data : []);
      setPermCatalog(Array.isArray(cRes.data) ? cRes.data : []);
      setPermMatrix(mRes.data?.matrix || {});
    } catch (err) {
      const msg = messageFromAxiosError(err, "Failed to load admin data");
      setError(msg);
      setUsers([]);
      setRoles([]);
      setPermCatalog([]);
      setPermMatrix({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ids = permMatrix[permRole];
    if (Array.isArray(ids)) setPermDraft([...ids]);
    else setPermDraft([]);
  }, [permRole, permMatrix]);

  const permissionTableSections = useMemo(() => {
    const byGroup = {};
    for (const p of permCatalog) {
      const gr = p.group || "Other";
      if (!byGroup[gr]) byGroup[gr] = [];
      byGroup[gr].push(p);
    }
    const ordered = [
      ...PERM_GROUP_ORDER.filter((g) => byGroup[g]),
      ...Object.keys(byGroup)
        .filter((g) => !PERM_GROUP_ORDER.includes(g))
        .sort(),
    ];
    return ordered.map((group) => ({
      group,
      rows: buildPermissionTableRows(byGroup[group] || []),
    }));
  }, [permCatalog]);

  const togglePerm = (permId, checked) => {
    setPermDraft((prev) => {
      if (checked) return prev.includes(permId) ? prev : [...prev, permId];
      return prev.filter((x) => x !== permId);
    });
  };

  const savePermissions = async () => {
    setPermSaving(true);
    try {
      await API.put(Endpoints.admin.setRolePermissions(permRole), { permission_ids: permDraft });
      toast.success("Permissions saved");
      const { data } = await API.get(Endpoints.admin.permissionsMatrix());
      setPermMatrix(data?.matrix || {});
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message || "Save failed");
    } finally {
      setPermSaving(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const handleRoleChange = async (userId, newRole) => {
    try {
      await API.put(Endpoints.admin.setUserRole(userId), { role: newRole });
      setUsers((prev) => prev.map((x) => (x.user_id === userId || x._id === userId ? { ...x, role: newRole } : x)));
      toast.success("Role updated");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message || "Update failed");
    }
  };

  const filtered = users.filter(
    (u) =>
      !search ||
      (u.name && u.name.toLowerCase().includes(search.toLowerCase())) ||
      (u.email && u.email.toLowerCase().includes(search.toLowerCase()))
  );

  if (error && !loading) {
    return (
      <div data-testid="admin-page" className="max-w-lg">
        <div className="page-header">
          <h1 className="page-title">Admin Console</h1>
        </div>
        <AsyncPanel error={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="admin-page">
      <div>
        <h1 className="page-title">Admin Console</h1>
        <p className="page-desc">User management, role catalog, and permission matrix</p>
      </div>

      {loading && users.length === 0 ? (
        <AsyncPanel loading minHeight="min-h-[240px]" />
      ) : (
        <Tabs defaultValue="users" className="space-y-4">
          <TabsList className="bg-gray-100">
            <TabsTrigger value="users" className="text-xs" data-testid="tab-users">
              <Users className="w-3.5 h-3.5 mr-1" />
              Users ({total})
            </TabsTrigger>
            <TabsTrigger value="roles" className="text-xs" data-testid="tab-roles">
              <Shield className="w-3.5 h-3.5 mr-1" />
              Roles
            </TabsTrigger>
            <TabsTrigger value="permissions" className="text-xs" data-testid="tab-permissions">
              <KeyRound className="w-3.5 h-3.5 mr-1" />
              Permissions
            </TabsTrigger>
          </TabsList>
          <TabsContent value="users">
            <Card className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-200 flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="bg-transparent text-sm outline-none flex-1"
                    data-testid="user-search"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="users-table">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-2 text-left font-semibold">User</th>
                      <th className="px-3 py-2 text-left font-semibold">Email</th>
                      <th className="px-3 py-2 text-left font-semibold">Role</th>
                      <th className="px-3 py-2 text-left font-semibold">Joined</th>
                      <th className="px-3 py-2 text-left font-semibold">Change role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((u, i) => {
                      const uid = u.user_id || u._id;
                      return (
                        <tr
                          key={uid}
                          className={`border-b border-gray-100 hover:bg-gray-50 ${
                            i % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-[#C8102E] flex items-center justify-center text-white text-xs font-bold shrink-0">
                                {u.name?.[0]?.toUpperCase() || "U"}
                              </div>
                              <span className="text-xs font-semibold text-gray-800">{u.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-600">{u.email}</td>
                          <td className="px-3 py-2.5">
                            <Badge
                              className={`text-[10px] border ${
                                ROLE_STYLES[u.role] || "bg-gray-50 text-gray-600 border-gray-200"
                              }`}
                            >
                              {roles.find((r) => r.id === u.role)?.name || u.role?.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-500">
                            {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <Select value={u.role} onValueChange={(v) => handleRoleChange(uid, v)}>
                              <SelectTrigger className="w-40 h-7 text-[10px]" data-testid={`role-select-${uid}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {roles.map((r) => (
                                  <SelectItem key={r.id} value={r.id} className="text-xs">
                                    {r.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                          No users found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
          <TabsContent value="roles">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {roles.map((r) => (
                <Card key={r.id} className="bg-white border border-gray-200 rounded-lg shadow-sm" data-testid={`role-card-${r.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-[#1A1A1A]">{r.name}</h3>
                      <Badge className="text-[9px] bg-gray-50 text-gray-600 border border-gray-200">Level {r.level}</Badge>
                    </div>
                    <p className="text-[10px] text-gray-400 font-mono">{r.id}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="permissions">
            <Card className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <CardContent className="p-4 space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase text-gray-500">Role</label>
                    <Select value={permRole} onValueChange={setPermRole}>
                      <SelectTrigger className="w-56 h-9 text-sm" data-testid="perm-role-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.id} className="text-xs">
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    onClick={savePermissions}
                    disabled={permSaving}
                    className="bg-[#C8102E] hover:bg-[#A50E25]"
                    data-testid="perm-save-btn"
                  >
                    {permSaving ? "Saving…" : "Save for role"}
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Use the matrix to grant View / Create / Edit / Delete per capability. Changes are stored for the selected role.
                </p>
                <div className="space-y-6 max-h-[min(70vh,560px)] overflow-y-auto pr-1">
                  {permissionTableSections.map(({ group, rows }) => (
                    <div key={group}>
                      <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">{group}</h3>
                      <div className="rounded-lg border border-gray-200 overflow-x-auto bg-white shadow-sm">
                        <table className="w-full text-sm min-w-[480px]">
                          <thead>
                            <tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                              <th className="text-left px-3 py-2.5 font-semibold">Capability</th>
                              {PERM_ACTION_KEYS.map((a) => (
                                <th key={a} className="text-center px-2 py-2.5 font-semibold w-[4.5rem]">
                                  {PERM_ACTION_LABELS[a]}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, idx) => (
                              <tr
                                key={row.resourceKey}
                                className={`border-b border-gray-100 last:border-0 ${idx % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"}`}
                              >
                                <td className="px-3 py-2 text-gray-900 font-medium">{row.title}</td>
                                {PERM_ACTION_KEYS.map((action) => {
                                  const pid = row.cells[action];
                                  if (!pid) {
                                    return (
                                      <td key={action} className="text-center px-2 py-2 text-gray-200 text-xs">
                                        —
                                      </td>
                                    );
                                  }
                                  return (
                                    <td key={action} className="text-center px-2 py-2 align-middle">
                                      <div className="flex justify-center">
                                        <Checkbox
                                          checked={permDraft.includes(pid)}
                                          onCheckedChange={(c) => togglePerm(pid, c === true)}
                                          data-testid={`perm-check-${permRole}-${pid}`}
                                          title={pid}
                                        />
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
