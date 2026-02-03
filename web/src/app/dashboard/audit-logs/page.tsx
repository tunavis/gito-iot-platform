'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import { User, Clock, Search, Download, Eye, Activity } from 'lucide-react';

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
      alert('You do not have permission to view audit logs. Contact your administrator.');
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

  const actionColor = (action: string) => {
    const colors: Record<string, string> = {
      create: 'bg-green-100 text-green-700',
      update: 'bg-blue-100 text-blue-700',
      delete: 'bg-red-100 text-red-700',
      login: 'bg-purple-100 text-purple-700',
      logout: 'bg-gray-100 text-gray-600',
      access: 'bg-cyan-100 text-cyan-700',
    };
    return colors[action.toLowerCase()] || 'bg-gray-100 text-gray-600';
  };

  const actionIcon = (action: string) => {
    const icons: Record<string, string> = {
      create: '➕',
      update: '✏️',
      delete: '🗑️',
      login: '🔓',
      logout: '🔒',
      access: '👁️',
    };
    return icons[action.toLowerCase()] || '📝';
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
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Audit Logs</h1>
              <p className="text-gray-600 mt-2">Security and compliance monitoring</p>
            </div>
            <button
              onClick={exportToCsv}
              className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center gap-2 shadow-sm"
            >
              <Download className="w-5 h-5" />
              Export CSV
            </button>
          </div>

          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-6">
              <div className="bg-white rounded-lg p-6 border border-primary-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-600 text-sm font-medium mb-1">Total Events</p>
                    <p className="text-3xl font-bold text-slate-900">{stats.total_logs.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Last {stats.period.days} days</p>
                  </div>
                  <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
                    <Activity className="w-6 h-6 text-primary-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-6 border border-green-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-600 text-sm font-medium mb-1">Creates</p>
                    <p className="text-3xl font-bold text-green-600">{stats.action_counts.create || 0}</p>
                    <p className="text-xs text-gray-500 mt-1">New resources</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center text-3xl">
                    ➕
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-6 border border-blue-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-600 text-sm font-medium mb-1">Updates</p>
                    <p className="text-3xl font-bold text-blue-600">{stats.action_counts.update || 0}</p>
                    <p className="text-xs text-gray-500 mt-1">Modifications</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-3xl">
                    ✏️
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-6 border border-red-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-600 text-sm font-medium mb-1">Deletions</p>
                    <p className="text-3xl font-bold text-red-600">{stats.action_counts.delete || 0}</p>
                    <p className="text-xs text-gray-500 mt-1">Removed items</p>
                  </div>
                  <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center text-3xl">
                    🗑️
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 mb-6">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3.5 top-3 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search action or resource type..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full pl-11 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Action</label>
              <select
                value={filterAction}
                onChange={(e) => {
                  setFilterAction(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">All Actions</option>
                <option value="create">Create</option>
                <option value="update">Update</option>
                <option value="delete">Delete</option>
                <option value="login">Login</option>
                <option value="logout">Logout</option>
                <option value="access">Access</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Resource Type</label>
              <select
                value={filterResourceType}
                onChange={(e) => {
                  setFilterResourceType(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
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
        </div>

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="border-b border-gray-200 px-6 py-3 bg-gray-50">
            <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-gray-600 uppercase">
              <div className="col-span-2">Timestamp</div>
              <div className="col-span-2">Action</div>
              <div className="col-span-2">Resource</div>
              <div className="col-span-2">User</div>
              <div className="col-span-2">IP Address</div>
              <div className="col-span-2 text-right">Details</div>
            </div>
          </div>
          <div className="divide-y divide-gray-200">
            {loading ? (
              <div className="px-6 py-8 text-center text-sm text-gray-600">Loading audit logs...</div>
            ) : logs.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-gray-600">
                No audit logs found for the selected filters.
              </div>
            ) : (
              logs.map(log => {
                const timestamp = formatDate(log.created_at);
                return (
                  <div key={log.id} className="px-6 py-4 hover:bg-gray-50">
                    <div className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-2">
                        <div className="flex items-start gap-2">
                          <Clock className="w-4 h-4 text-gray-400 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{timestamp.date}</p>
                            <p className="text-xs text-gray-500">{timestamp.time}</p>
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <span className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 w-fit ${actionColor(log.action)}`}>
                          <span>{actionIcon(log.action)}</span>
                          <span className="capitalize">{log.action}</span>
                        </span>
                      </div>
                      <div className="col-span-2">
                        {log.resource_type ? (
                          <div>
                            <p className="text-sm font-medium text-gray-900 capitalize">{log.resource_type}</p>
                            {log.resource_id && (
                              <p className="text-xs text-gray-500 font-mono">{log.resource_id.substring(0, 8)}...</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        {log.user_id ? (
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="text-xs text-gray-600 font-mono">{log.user_id.substring(0, 8)}...</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500 italic">System</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <span className="text-xs text-gray-600 font-mono">{log.ip_address || '—'}</span>
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors flex items-center gap-1 text-sm"
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                          <span>Details</span>
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
            <div className="border-t border-gray-200 px-6 py-3 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {((currentPage - 1) * perPage) + 1} to {Math.min(currentPage * perPage, totalLogs)} of {totalLogs} logs
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="px-4 py-2 text-sm text-gray-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Audit Log Details</h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Timestamp</label>
                  <p className="text-sm text-gray-900">{new Date(selectedLog.created_at).toLocaleString()}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
                  <span className={`px-2 py-1 text-xs font-medium rounded capitalize ${actionColor(selectedLog.action)}`}>
                    {selectedLog.action}
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Resource Type</label>
                  <p className="text-sm text-gray-900 capitalize">{selectedLog.resource_type || '—'}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Resource ID</label>
                  <p className="text-sm text-gray-900 font-mono">{selectedLog.resource_id || '—'}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">User ID</label>
                  <p className="text-sm text-gray-900 font-mono">{selectedLog.user_id || 'System'}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">IP Address</label>
                  <p className="text-sm text-gray-900 font-mono">{selectedLog.ip_address || '—'}</p>
                </div>
              </div>

              {selectedLog.user_agent && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">User Agent</label>
                  <p className="text-xs text-gray-700 bg-gray-50 p-2 rounded font-mono break-all">{selectedLog.user_agent}</p>
                </div>
              )}

              {selectedLog.changes && Object.keys(selectedLog.changes).length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Changes</label>
                  <pre className="text-xs text-gray-700 bg-gray-50 p-3 rounded overflow-x-auto">
                    {JSON.stringify(selectedLog.changes, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-5 py-2.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
