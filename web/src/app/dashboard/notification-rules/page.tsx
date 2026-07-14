'use client';

import { useEffect, useState } from 'react';
import PageShell from '@/components/ui/PageShell';
import Modal from '@/components/ui/Modal';
import StatCard from '@/components/ui/StatCard';
import { btn, input } from '@/components/ui/buttonStyles';
import { useToast } from '@/components/ToastProvider';
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
  const toast = useToast();
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
    const ok = await toast.confirm('Are you sure you want to delete this alert route?', { title: 'Delete Alert Route', variant: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;

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
    <PageShell
      title="Alert Routing"
      subtitle="Route alerts to notification channels"
      action={
        <button
          onClick={() => setShowNewForm(true)}
          className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center gap-2 shadow-sm"
        >
          <Plus className="w-5 h-5" />
          Add Route
        </button>
      }
    >
      <div className="mb-8">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
            <StatCard label="Total Routes" value={rules.length} icon={<Shield className="w-5 h-5" />} accent="#2563eb" />
            <StatCard
              label="Enabled"
              value={rules.filter(r => r.enabled).length}
              icon={<ToggleRight className="w-5 h-5" />}
              accent="#16a34a"
              color="#16a34a"
            />
            <StatCard
              label="Channels"
              value={channels.filter(c => c.enabled).length}
              icon={<Bell className="w-5 h-5" />}
              accent="#2563eb"
              color="#2563eb"
            />
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

        <div className="bg-surface rounded-xl border border-th-default shadow-sm overflow-hidden">
          <div className="border-b border-th-default px-6 py-3 bg-page">
            <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-th-secondary uppercase">
              <div className="col-span-4">Alert Rule</div>
              <div className="col-span-3">Channel Type</div>
              <div className="col-span-2">Channel Detail</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {loading ? (
              <div className="px-6 py-8 text-center text-sm text-th-secondary">Loading routes...</div>
            ) : rules.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-th-secondary">
                No alert routes found. Click &quot;Add Route&quot; to create one.
              </div>
            ) : (
              rules.map(rule => {
                const channel = getChannelDisplay(rule.channel_id);
                return (
                  <div key={rule.id} className="px-6 py-4 hover:bg-panel">
                    <div className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-4">
                        <div className="flex items-center gap-2">
                          <Bell className="w-4 h-4 text-th-muted" />
                          <span className="text-sm font-medium text-th-primary">
                            {getAlertRuleName(rule.alert_rule_id)}
                          </span>
                        </div>
                      </div>
                      <div className="col-span-3">
                        <div className="flex items-center gap-2">
                          {channel.icon}
                          <span className="text-sm text-th-primary capitalize">{channel.type}</span>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <span className="text-sm text-th-secondary truncate block">{channel.detail}</span>
                      </div>
                      <div className="col-span-1">
                        <button
                          onClick={() => toggleRule(rule.id, rule.enabled)}
                          className={`flex items-center gap-1 text-xs font-medium ${
                            rule.enabled ? 'text-green-600' : 'text-th-muted'
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
                          className="p-2 text-th-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
    </PageShell>
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
    <Modal open onClose={onCancel} title="Add Alert Route">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-th-primary mb-1">Alert Rule *</label>
            <select
              required
              value={formData.alert_rule_id}
              onChange={(e) => setFormData({ ...formData, alert_rule_id: e.target.value })}
              className={input.select}
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
            <label className="block text-sm font-medium text-th-primary mb-1">Notification Channel *</label>
            <select
              required
              value={formData.channel_id}
              onChange={(e) => setFormData({ ...formData, channel_id: e.target.value })}
              className={input.select}
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
              className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-[var(--color-input-border)] rounded"
            />
            <label className="text-sm text-th-primary">Enable route immediately</label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className={`flex-1 ${btn.secondary}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`flex-1 ${btn.primary} disabled:opacity-50`}
            >
              {submitting ? 'Creating...' : 'Create Route'}
            </button>
          </div>
        </form>
    </Modal>
  );
}
