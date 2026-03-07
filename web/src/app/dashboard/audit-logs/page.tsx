'use client';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import { User, Clock, Search, Download, Eye, Activity, Plus, Edit2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import StatCard from '@/components/ui/StatCard';
import { btn, input } from '@/components/ui/buttonStyles';

interface AuditLog {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  changes: Record<string, any> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuditStats {
  period: {
    days: number;
    start_date: string;
    end_date: string;
  };
  total_logs: number;
  action_counts: Record<string, number>;
  resource_counts: Record<string, number>;
  top_users: Array<{ user_id: string; action_count: number }>;
}

export default function AuditLogsPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>('');
  const [filterResourceType, setFilterResourceType] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const perPage = 50;

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    let url = `/api/v1/tenants/${tenant}/audit-logs?page=${currentPage}&per_page=${perPage}`;
    if (filterAction) url += `&action=${filterAction}`;
    if (filterResourceType) url += `&resource_type=${filterResourceType}`;
    if (searchTerm) url += `&search=${encodeURIComponent(searchTerm)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      const json = await res.json();
      setLogs(json.data || []);
      setTotalLogs(json.meta?.total || 0);
    } else if (res.status === 403) {
      toast.error('Permission denied', 'You do not have permission to view audit logs. Contact your administrator.');
    }
    setLoading(false);
  }, [currentPage, filterAction, filterResourceType, searchTerm, perPage]);

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const loadStats = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const res = await fetch(`/api/v1/tenants/${tenant}/audit-logs/stats?days=30`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      const json = await res.json();
      setStats(json.data || null);
    }
  };

  const exportToCsv = () => {
    const headers = ['Date/Time', 'User ID', 'Action', 'Resource Type', 'Resource ID', 'IP Address'];
    const rows = logs.map(log => [
      new Date(log.created_at).toLocaleString(),
      log.user_id || 'System',
      log.action,
      log.resource_type || '—',
      log.resource_id || '—',
      log.ip_address || '—'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const actionVariant = (action: string): 'success' | 'info' | 'danger' | 'purple' | 'neutral' | 'warning' => {
    const map: Record<string, 'success' | 'info' | 'danger' | 'purple' | 'neutral' | 'warning'> = {
      create: 'success', update: 'info', delete: 'danger',
      login: 'purple', logout: 'neutral', access: 'warning',
    };
    return map[action.toLowerCase()] || 'neutral';
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return {
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
  };

  const totalPages = Math.ceil(totalLogs / perPage);

  return (
    <PageShell
      title="Audit Logs"
      subtitle="Security and compliance monitoring"
      action={
        <button onClick={exportToCsv} className={`${btn.primary} flex items-center gap-2`}>
          <Download className="w-4 h-4" />Export CSV
        </button>
      }
    >
      {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label={`Total Events (${stats.period.days}d)`} value={stats.total_logs.toLocaleString()} icon={<Activity className="w-5 h-5" />} accent="#2563eb" color="#2563eb" />
            <StatCard label="Creates" value={stats.action_counts.create || 0} icon={<Plus className="w-5 h-5" />} accent="#16a34a" color="#16a34a" />
            <StatCard label="Updates" value={stats.action_counts.update || 0} icon={<Edit2 className="w-5 h-5" />} accent="#2563eb" color="#2563eb" />
            <StatCard label="Deletions" value={stats.action_counts.delete || 0} icon={<Trash2 className="w-5 h-5" />} accent="#dc2626" color="#dc2626" />
          </div>
        )}

        {/* Filters */}
        <div className="gito-card p-4 mb-6">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search action or resource type..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className={`${input.base} pl-9`}
              />
            </div>
            <select value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setCurrentPage(1); }} className={input.select} style={{ width: 'auto' }}>
              <option value="">All Actions</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="login">Login</option>
              <option value="logout">Logout</option>
              <option value="access">Access</option>
            </select>
            <select value={filterResourceType} onChange={(e) => { setFilterResourceType(e.target.value); setCurrentPage(1); }} className={input.select} style={{ width: 'auto' }}>
              <option value="">All Resources</option>
              <option value="device">Device</option>
              <option value="user">User</option>
              <option value="alert">Alert</option>
              <option value="organization">Organization</option>
              <option value="site">Site</option>
              <option value="device_group">Device Group</option>
            </select>
          </div>
        </div>

        <div className="gito-card overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-6 py-3 bg-panel">
            <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-th-muted uppercase tracking-widest">
              <div className="col-span-2">Timestamp</div>
              <div className="col-span-2">Action</div>
              <div className="col-span-2">Resource</div>
              <div className="col-span-2">User</div>
              <div className="col-span-2">IP Address</div>
              <div className="col-span-2 text-right">Details</div>
            </div>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {loading ? (
              <div className="px-6 py-8 text-center text-sm text-th-secondary">Loading audit logs...</div>
            ) : logs.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-th-secondary">
                No audit logs found for the selected filters.
              </div>
            ) : (
              logs.map(log => {
                const timestamp = formatDate(log.created_at);
                return (
                  <div key={log.id} className="px-6 py-4 hover:bg-panel transition-colors">
                    <div className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-2">
                        <div className="flex items-start gap-2">
                          <Clock className="w-3.5 h-3.5 text-th-muted mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-medium text-th-primary">{timestamp.date}</p>
                            <p className="text-xs text-th-muted">{timestamp.time}</p>
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <Badge variant={actionVariant(log.action)} label={log.action} size="sm" />
                      </div>
                      <div className="col-span-2">
                        {log.resource_type ? (
                          <div>
                            <p className="text-sm font-medium text-th-primary capitalize">{log.resource_type}</p>
                            {log.resource_id && (
                              <p className="text-xs text-th-muted font-mono">{log.resource_id.substring(0, 8)}...</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-th-muted">—</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        {log.user_id ? (
                          <div className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-th-muted flex-shrink-0" />
                            <span className="text-xs text-th-muted font-mono">{log.user_id.substring(0, 8)}...</span>
                          </div>
                        ) : (
                          <span className="text-xs text-th-muted italic">System</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <span className="text-xs text-th-muted font-mono">{log.ip_address || '—'}</span>
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <button onClick={() => setSelectedLog(log)} className={btn.icon} title="View details">
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="border-t border-[var(--color-border)] px-6 py-3 flex items-center justify-between bg-panel">
              <div className="text-xs text-th-muted">
                Showing {((currentPage - 1) * perPage) + 1}–{Math.min(currentPage * perPage, totalLogs)} of {totalLogs} logs
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className={`${btn.secondary} disabled:opacity-50 disabled:cursor-not-allowed text-xs`}>
                  Previous
                </button>
                <span className="px-3 py-2 text-xs text-th-secondary">Page {currentPage} of {totalPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className={`${btn.secondary} disabled:opacity-50 disabled:cursor-not-allowed text-xs`}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="gito-card w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-th-primary">Audit Log Details</h3>
              <button onClick={() => setSelectedLog(null)} className={btn.icon}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1">Timestamp</label>
                  <p className="text-sm text-th-primary">{new Date(selectedLog.created_at).toLocaleString()}</p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1">Action</label>
                  <Badge variant={actionVariant(selectedLog.action)} label={selectedLog.action} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1">Resource Type</label>
                  <p className="text-sm text-th-primary capitalize">{selectedLog.resource_type || '—'}</p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1">Resource ID</label>
                  <p className="text-sm text-th-primary font-mono">{selectedLog.resource_id || '—'}</p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1">User ID</label>
                  <p className="text-sm text-th-primary font-mono">{selectedLog.user_id || 'System'}</p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1">IP Address</label>
                  <p className="text-sm text-th-primary font-mono">{selectedLog.ip_address || '—'}</p>
                </div>
              </div>

              {selectedLog.user_agent && (
                <div>
                  <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1">User Agent</label>
                  <p className="text-xs text-th-primary font-mono break-all p-2 rounded" style={{ background: 'var(--color-page)', border: '1px solid var(--color-border)' }}>{selectedLog.user_agent}</p>
                </div>
              )}

              {selectedLog.changes && Object.keys(selectedLog.changes).length > 0 && (
                <div>
                  <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1">Changes</label>
                  <pre className="text-xs text-th-primary font-mono p-3 rounded overflow-x-auto" style={{ background: 'var(--color-page)', border: '1px solid var(--color-border)' }}>
                    {JSON.stringify(selectedLog.changes, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button onClick={() => setSelectedLog(null)} className={btn.secondary}>Close</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
