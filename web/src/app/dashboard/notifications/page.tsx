'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';

interface NotificationChannel {
  id: string;
  user_id: string;
  channel_type: 'email' | 'webhook' | 'sms';
  enabled: boolean;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface NotificationRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  alert_type: string;
  severity: string;
  enabled: boolean;
  channel_ids: string[];
  created_at: string;
  updated_at: string;
}

interface Notification {
  id: string;
  tenant_id: string;
  channel_id: string;
  alert_id: string;
  status: 'pending' | 'sent' | 'failed';
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<'channels' | 'rules' | 'history'>('channels');
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewChannelForm, setShowNewChannelForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'channel' | 'rule'; id: string; name: string } | null>(null);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    setLoading(true);

    if (activeTab === 'channels') {
      const res = await fetch('/api/v1/notifications/channels', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setChannels(Array.isArray(json.data) ? json.data : json);
      }
    } else if (activeTab === 'rules') {
      const res = await fetch('/api/v1/notifications/rules', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setRules(Array.isArray(json.data) ? json.data : json);
      }
    } else {
      const res = await fetch('/api/v1/notifications?page=1&per_page=100', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setNotifications(json.data || []);
      }
    }

    setLoading(false);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    if (deleteConfirm.type === 'channel') {
      const res = await fetch(`/api/v1/notifications/channels/${deleteConfirm.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setChannels(prev => prev.filter(c => c.id !== deleteConfirm.id));
      }
    } else {
      const res = await fetch(`/api/v1/notifications/rules/${deleteConfirm.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setRules(prev => prev.filter(r => r.id !== deleteConfirm.id));
      }
    }
    setDeleteConfirm(null);
  };

  const toggleChannel = async (id: string, enabled: boolean) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const res = await fetch(`/api/v1/notifications/channels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled: !enabled })
    });

    if (res.ok) {
      setChannels(prev => prev.map(c => c.id === id ? { ...c, enabled: !enabled } : c));
    }
  };


  const getChannelTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return '📧';
      case 'sms': return '📱';
      case 'webhook': return '🔗';
      default: return '📬';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent': return 'bg-green-100 text-green-700';
      case 'pending': return 'bg-yellow-100 text-yellow-700';
      case 'failed': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Notifications</h1>
          <p className="text-gray-600">Configure notification channels and rules</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('channels')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'channels'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Channels
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'rules'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Rules
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            History
          </button>
        </div>

        {/* Channels Tab */}
        {activeTab === 'channels' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Notification Channels</h2>
                <p className="text-sm text-gray-600 mt-1">Configure email, SMS, and webhook endpoints</p>
              </div>
              <button
                onClick={() => setShowNewChannelForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
              >
                + Add Channel
              </button>
            </div>

            {showNewChannelForm && (
              <AddChannelForm
                onSuccess={() => {
                  setShowNewChannelForm(false);
                  loadData();
                }}
                onCancel={() => setShowNewChannelForm(false)}
              />
            )}

            {editingChannel && (
              <EditChannelForm
                channel={editingChannel}
                onSuccess={() => {
                  setEditingChannel(null);
                  loadData();
                }}
                onCancel={() => setEditingChannel(null)}
              />
            )}

            {loading ? (
              <div className="text-center py-8 text-gray-600">Loading channels...</div>
            ) : channels.length === 0 ? (
              <div className="bg-white rounded border border-gray-200 p-12 text-center">
                <p className="text-gray-600 mb-4">No notification channels configured</p>
                <button
                  onClick={() => setShowNewChannelForm(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Create First Channel
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {channels.map(channel => (
                  <div key={channel.id} className="bg-white rounded border border-gray-200 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1">
                        <div className="text-3xl">{getChannelTypeIcon(channel.channel_type)}</div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900 capitalize">{channel.channel_type}</h3>
                          <p className="text-sm text-gray-600">{JSON.stringify(channel.config)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleChannel(channel.id, channel.enabled)}
                          className={`px-3 py-1 text-xs font-medium rounded ${
                            channel.enabled
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {channel.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                        <button
                          onClick={() => setEditingChannel(channel)}
                          className="px-3 py-1 text-xs font-medium rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'channel', id: channel.id, name: channel.channel_type })}
                          className="px-3 py-1 text-xs font-medium rounded bg-red-50 text-red-600 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rules Tab */}
        {activeTab === 'rules' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Notification Rules</h2>
                <p className="text-sm text-gray-600 mt-1">Define which alerts trigger notifications</p>
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium">
                + Add Rule
              </button>
            </div>

            {loading ? (
              <div className="text-center py-8 text-gray-600">Loading rules...</div>
            ) : rules.length === 0 ? (
              <div className="bg-white rounded border border-gray-200 p-12 text-center">
                <p className="text-gray-600 mb-4">No notification rules configured</p>
                <p className="text-sm text-gray-500">Rules determine which channels receive alerts based on type and severity</p>
              </div>
            ) : (
              <div className="bg-white rounded border border-gray-200">
                <table className="w-full">
                  <thead className="border-b border-gray-200 bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Alert Type</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Severity</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Channels</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {rules.map(rule => (
                      <tr key={rule.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <p className="font-medium text-gray-900">{rule.name}</p>
                          <p className="text-xs text-gray-600">{rule.description}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-700">{rule.alert_type}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${
                            rule.severity === 'critical' ? 'bg-red-100 text-red-700' :
                            rule.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                            rule.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {rule.severity}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-700">{rule.channel_ids.length} channel(s)</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => setDeleteConfirm({ type: 'rule', id: rule.id, name: rule.name })}
                            className="text-red-600 hover:text-red-700 text-sm font-medium"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Notification History</h2>
              <p className="text-sm text-gray-600 mt-1">Recent notifications sent to channels</p>
            </div>

            {loading ? (
              <div className="text-center py-8 text-gray-600">Loading history...</div>
            ) : notifications.length === 0 ? (
              <div className="bg-white rounded border border-gray-200 p-12 text-center">
                <p className="text-gray-600">No notifications sent yet</p>
              </div>
            ) : (
              <div className="bg-white rounded border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead className="border-b border-gray-200 bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Alert</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Channel</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Sent At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {notifications.map(notif => (
                      <tr key={notif.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <span className="text-sm font-mono text-gray-700">{notif.alert_id.substring(0, 8)}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-700">{notif.channel_id.substring(0, 8)}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(notif.status)}`}>
                            {notif.status.charAt(0).toUpperCase() + notif.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {notif.sent_at ? new Date(notif.sent_at).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Deletion</h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete this {deleteConfirm.type === 'channel' ? 'notification channel' : 'notification rule'}? 
                <span className="font-medium text-gray-900"> {deleteConfirm.name}</span>
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function AddChannelForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [type, setType] = useState<'email' | 'webhook' | 'sms'>('email');
  const [config, setConfig] = useState<Record<string, any>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const res = await fetch('/api/v1/notifications/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel_type: type, config, enabled: true })
    });

    if (res.ok) {
      onSuccess();
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded p-6 mb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Notification Channel</h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Channel Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value as 'email' | 'webhook' | 'sms')}
              className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
            >
              <option value="email">Email</option>
              <option value="webhook">Webhook</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          {type === 'email' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Email Address</label>
              <input
                type="email"
                value={config.email || ''}
                onChange={e => setConfig(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded"
                required
              />
            </div>
          )}
          {type === 'webhook' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Webhook URL</label>
              <input
                type="url"
                value={config.url || ''}
                onChange={e => setConfig(prev => ({ ...prev, url: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded"
                required
              />
            </div>
          )}
          {type === 'sms' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Phone Number</label>
              <input
                type="tel"
                value={config.phone || ''}
                onChange={e => setConfig(prev => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded"
                required
              />
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Add Channel
          </button>
        </div>
      </form>
    </div>
  );
}

function EditChannelForm({ channel, onSuccess, onCancel }: { channel: NotificationChannel; onSuccess: () => void; onCancel: () => void }) {
  const [config, setConfig] = useState(channel.config);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const res = await fetch(`/api/v1/notifications/channels/${channel.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ config })
    });

    if (res.ok) {
      onSuccess();
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded p-6 mb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Channel</h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Type</label>
            <input type="text" value={channel.channel_type} disabled className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-50" />
          </div>
          {channel.channel_type === 'email' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={config.email || ''}
                onChange={e => setConfig(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded"
              />
            </div>
          )}
          {channel.channel_type === 'webhook' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">URL</label>
              <input
                type="url"
                value={config.url || ''}
                onChange={e => setConfig(prev => ({ ...prev, url: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded"
              />
            </div>
          )}
          {channel.channel_type === 'sms' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Phone</label>
              <input
                type="tel"
                value={config.phone || ''}
                onChange={e => setConfig(prev => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded"
              />
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Update Channel
          </button>
        </div>
      </form>
    </div>
  );
}
