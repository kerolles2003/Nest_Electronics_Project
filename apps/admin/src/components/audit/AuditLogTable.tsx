"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { 
  History, 
  Search, 
  Eye, 
  User as UserIcon,
  Package,
  ShoppingCart,
  ShieldCheck,
  MoreVertical,
  Calendar
} from "lucide-react";
import { Button } from "@nest/ui";

interface AuditLog {
  id: string;
  admin_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: any;
  created_at: string;
  admin: {
    full_name: string;
    avatar_url: string;
  };
}

interface AuditLogTableProps {
  initialLogs: AuditLog[];
}

export function AuditLogTable({ initialLogs }: AuditLogTableProps) {
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const filteredLogs = useMemo(() => {
    return initialLogs.filter((log) => {
      const searchStr = `${log.action} ${log.entity_type} ${log.admin?.full_name}`.toLowerCase();
      return searchStr.includes(search.toLowerCase());
    });
  }, [initialLogs, search]);

  const getActionColor = (action: string) => {
    switch (action) {
      case "CREATE": return "bg-emerald-100 text-emerald-700 border-emerald-200";
      case "UPDATE": return "bg-blue-100 text-blue-700 border-blue-200";
      case "DELETE":
      case "SOFT_DELETE": return "bg-red-100 text-red-700 border-red-200";
      case "TOGGLE_STATUS": return "bg-amber-100 text-amber-700 border-amber-200";
      default: return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case "product": return <Package className="h-4 w-4" />;
      case "order": return <ShoppingCart className="h-4 w-4" />;
      case "auth": return <ShieldCheck className="h-4 w-4" />;
      default: return <History className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by admin, action, or entity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full pl-10 pr-4 rounded-xl border bg-background text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Timestamp</th>
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Admin</th>
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Action</th>
                <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Entity</th>
                <th className="text-right px-6 py-4 font-semibold text-muted-foreground">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center text-muted-foreground italic">
                    No activity records found matching your search.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {new Date(log.created_at).toLocaleDateString()}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(log.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="relative h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden border">
                          {log.admin?.avatar_url ? (
                              <Image src={log.admin.avatar_url} alt="" fill sizes="32px" className="object-cover" />
                          ) : (
                            <UserIcon className="h-4 w-4 text-primary" />
                          )}
                        </div>
                        <span className="font-medium">{log.admin?.full_name || "Unknown Admin"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {getEntityIcon(log.entity_type)}
                        <span className="capitalize">{log.entity_type}</span>
                        <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                          {log.entity_id.slice(0, 8)}...
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-8 w-8"
                        onClick={() => setSelectedLog(log)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Overlay (Simple implementation for now) */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-3">
                <History className="h-5 w-5 text-primary" />
                Action Details
              </h2>
              <Button size="icon" variant="ghost" onClick={() => setSelectedLog(null)}>
                <MoreVertical className="h-5 w-5 rotate-90" />
              </Button>
            </div>
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <p className="text-muted-foreground">Admin</p>
                  <p className="font-medium">{selectedLog.admin?.full_name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Action Type</p>
                  <p className="font-medium text-primary">{selectedLog.action}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Timestamp</p>
                  <p className="font-medium flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(selectedLog.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Entity ID</p>
                  <p className="font-mono text-[11px] truncate">{selectedLog.entity_id}</p>
                </div>
              </div>

              {selectedLog.changes && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Changes / Payload</p>
                  <div className="p-4 rounded-xl bg-muted font-mono text-[11px] overflow-x-auto border">
                    <pre>{JSON.stringify(selectedLog.changes, null, 2)}</pre>
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 border-t bg-muted/30 flex justify-end">
              <Button onClick={() => setSelectedLog(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
