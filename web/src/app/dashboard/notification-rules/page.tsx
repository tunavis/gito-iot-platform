'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { Bell, Plus, Trash2, ToggleLeft, ToggleRight, Shield, Mail, Globe } from 'lucide-react';

interface NotificationRule {
  id: string;
  tenant_id: string;
  alert_rule_id: string;
  channel_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface AlertRule {
  id: string;
  name?: string;
  device_id?: string;
  metric?: string;
  rule_type?: string;
}

interface NotificationChannel {
  id: string;
  channel_type: string;
  config: Record<string, any>;
  enabled: boolean;
}

export default function NotificationRulesPage() {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    // Load in parallel
    const [rulesRes, alertRulesRes, channelsRes] = await Promise.all([
      fetch(`/api/v1/tenants/${tenant}/notification-rules?page=1&per_page=100`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch(`/api/v1/tenants/${tenant}/alert-rules?page=1&per_page=100`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch(`/api/v1/tenants/${tenant}/notifications/channels`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    ]);

    if (rulesRes.ok) {
      const json = await rulesRes.json();
      setRules(json.data || []);
    }

    if (alertRulesRes.ok) {
      const json = await alertRulesRes.json();
      setAlertRules(json.data || []);
    }

    if (channelsRes.ok) {
      const json = await channelsRes.json();
      setChannels(json.data || []);
    }

    setLoading(false);
  };

  const toggleRule = async (id: string, currentState: boolean) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const res = await fetch(`/api/v1/tenants/${tenant}/notification-rules/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ enabled: !currentState })
    });

    if (res.ok) {
      loadData();
    }
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Are you sure you want to delete this alert route?')) return;

    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const res = await fetch(`/api/v1/tenants/${tenant}/notification-rules/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      loadData();
    }
  };

  const getAlertRuleName = (alertRuleId: string) => {
    const rule = alertRules.find(r => r.id === alertRuleId);
    if (!rule) return 'Unknown Alert Rule';
    if (rule.name) return rule.name;
    if (rule.metric) return `${rule.metric} Alert`;
    return `Alert Rule (${rule.rule_type || 'Unknown'})`;
  };

  const getChannelDisplay = (channelId: string) => {
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return { type: 'Unknown', detail: '—', icon: <Globe className="w-4 h-4" /> };

    const icons: Record<string, JSX.Element> = {
      email: <Mail className="w-4 h-4" />,
      sms: <Bell className="w-4 h-4" />,
      webhook: <Globe className="w-4 h-4" />,
      slack: <Bell className="w-4 h-4" />,
    };

    const detail = channel.config?.email || channel.config?.phone || channel.config?.webhook_url || 'Configured';

    return {
      type: channel.channel_type,
      detail,
      icon: icons[channel.channel_type] || <Bell className="w-4 h-4" />
    };
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Alert Routing</h1>
              <p className="text-gray-600 mt-2">Route alerts to notification channels</p>
            </div>
            <button
              onClick={() => setShowNewForm(true)}
              className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center gap-2 shadow-sm"
            >
              <Plus className="w-5 h-5" />
              Add Route
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
            <div className="bg-white rounded-lg p-6 border border-primary-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Total Routes</p>
                  <p className="text-3xl font-bold text-slate-900">{rules.length}</p>
                </div>
                <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
                  <Shield className="w-6 h-6 text-primary-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg p-6 border border-green-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Enabled</p>
                  <p className="text-3xl font-bold text-green-600">{rules.filter(r => r.enabled).length}</p>
                </div>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <ToggleRight className="w-6 h-6 text-green-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg p-6 border border-blue-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Channels</p>
                  <p className="text-3xl font-bold text-blue-600">{channels.filter(c => c.enabled).length}</p>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Bell className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {showNewForm && (
          <RuleForm
            alertRules={alertRules}
            channels={channels}
            onSuccess={() => {
              setShowNewForm(false);
              loadData();
            }}
            onCancel={() => setShowNewForm(false)}
          />
        )}

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="border-b border-gray-200 px-6 py-3 bg-gray-50">
            <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-gray-600 uppercase">
              <div className="col-span-4">Alert Rule</div>
              <div className="col-span-3">Channel Type</div>
              <div className="col-span-2">Channel Detail</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
          </div>
          <div className="divide-y divide-gray-200">
            {loading ? (
              <div className="px-6 py-8 text-center text-sm text-gray-600">Loading routes...</div>
            ) : rules.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-gray-600">
                No alert routes found. Click &quot;Add Route&quot; to create one.
              </div>
            ) : (
              rules.map(rule => {
                const channel = getChannelDisplay(rule.channel_id);
                return (
                  <div key={rule.id} className="px-6 py-4 hover:bg-gray-50">
                    <div className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-4">
                        <div className="flex items-center gap-2">
                          <Bell className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {getAlertRuleName(rule.alert_rule_id)}
                          </span>
                        </div>
                      </div>
                      <div className="col-span-3">
                        <div className="flex items-center gap-2">
                          {channel.icon}
                          <span className="text-sm text-gray-700 capitalize">{channel.type}</span>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <span className="text-sm text-gray-600 truncate block">{channel.detail}</span>
                      </div>
                      <div className="col-span-1">
                        <button
                          onClick={() => toggleRule(rule.id, rule.enabled)}
                          className={`flex items-center gap-1 text-xs font-medium ${
                            rule.enabled ? 'text-green-600' : 'text-gray-400'
                          }`}
                          title={rule.enabled ? 'Disable' : 'Enable'}
                        >
                          {rule.enabled ? (
                            <ToggleRight className="w-5 h-5" />
                          ) : (
                            <ToggleLeft className="w-5 h-5" />
                          )}
                          <span>{rule.enabled ? 'On' : 'Off'}</span>
                        </button>
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <button
                          onClick={() => deleteRule(rule.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete rule"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

interface RuleFormProps {
  alertRules: AlertRule[];
  channels: NotificationChannel[];
  onSuccess: () => void;
  onCancel: () => void;
}

function RuleForm({ alertRules, channels, onSuccess, onCancel }: RuleFormProps) {
  const [formData, setFormData] = useState({
    alert_rule_id: '',
    channel_id: '',
    enabled: true
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    try {
      const res = await fetch(`/api/v1/tenants/${tenant}/notification-rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        onSuccess();
      } else {
        const errorData = await res.json();
        setError(errorData.detail || 'Failed to create notification rule');
      }
    } catch (err) {
      setError('Network error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const getAlertRuleLabel = (rule: AlertRule) => {
    if (rule.name) return rule.name;
    if (rule.metric) return `${rule.metric} Alert`;
    return `Alert Rule (${rule.rule_type || 'Unknown'})`;
  };

  const getChannelLabel = (channel: NotificationChannel) => {
    const detail = channel.config?.email || channel.config?.phone || channel.config?.webhook_url;
    return `${channel.channel_type.toUpperCase()} - ${detail}`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Alert Route</h3>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Alert Rule *</label>
            <select
              required
              value={formData.alert_rule_id}
              onChange={(e) => setFormData({ ...formData, alert_rule_id: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select alert rule...</option>
              {alertRules.map(rule => (
                <option key={rule.id} value={rule.id}>
                  {getAlertRuleLabel(rule)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notification Channel *</label>
            <select
              required
              value={formData.channel_id}
              onChange={(e) => setFormData({ ...formData, channel_id: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select channel...</option>
              {channels.filter(c => c.enabled).map(channel => (
                <option key={channel.id} value={channel.id}>
                  {getChannelLabel(channel)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.enabled}
              onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
              className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <label className="text-sm text-gray-700">Enable route immediately</label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Creating...' : 'Create Route'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
