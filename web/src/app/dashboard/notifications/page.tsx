'use client';

import { useEffect, useState } from 'react';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import { Badge } from '@/components/ui/Badge';
import { btn, input } from '@/components/ui/buttonStyles';
import { Plus, Edit2, Trash2, Mail, Webhook, Smartphone, Bell } from 'lucide-react';

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
  alert_rule_id: string;
  channel_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface AlertRule {
  id: string;
  name: string;
  rule_type: string;
  severity: string;
}

interface Notification {
  id: string;
  channel_id: string;
  alert_event_id: string;
  channel_type: string;
  recipient: string;
  status: 'pending' | 'sent' | 'failed';
  sent_at: string | null;
  created_at: string;
}

// Helper to extract tenant_id from JWT token
function getTenantFromToken(): string | null {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.tenant_id || null;
  } catch {
    return null;
  }
}

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<'channels' | 'rules' | 'history'>('channels');
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewChannelForm, setShowNewChannelForm] = useState(false);
  const [showNewRuleForm, setShowNewRuleForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'channel' | 'rule'; id: string; name: string } | null>(null);
  const [tenant, setTenant] = useState<string | null>(null);

  useEffect(() => {
    const t = getTenantFromToken();
    setTenant(t);
  }, []);

  useEffect(() => {
    if (tenant) loadData();
  }, [activeTab, tenant]);

  const loadData = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    setLoading(true);

    if (activeTab === 'channels') {
      const res = await fetch(`/api/v1/tenants/${tenant}/notifications/channels`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setChannels(Array.isArray(json.data) ? json.data : json);
      }
    } else if (activeTab === 'rules') {
      // Load notification rules, alert rules, and channels in parallel
      const [rulesRes, alertRes, channelsRes] = await Promise.all([
        fetch(`/api/v1/tenants/${tenant}/notification-rules?per_page=100`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`/api/v1/tenants/${tenant}/alert-rules?per_page=100`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`/api/v1/tenants/${tenant}/notifications/channels`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
      ]);
      if (rulesRes.ok) {
        const json = await rulesRes.json();
        setRules(Array.isArray(json.data) ? json.data : json);
      }
      if (alertRes.ok) {
        const json = await alertRes.json();
        setAlertRules(Array.isArray(json.data) ? json.data : json);
      }
      if (channelsRes.ok) {
        const json = await channelsRes.json();
        setChannels(Array.isArray(json.data) ? json.data : json);
      }
    } else {
      const res = await fetch(`/api/v1/tenants/${tenant}/notifications?page=1&per_page=100`, {
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
    if (!deleteConfirm || !tenant) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    if (deleteConfirm.type === 'channel') {
      const res = await fetch(`/api/v1/tenants/${tenant}/notifications/channels/${deleteConfirm.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setChannels(prev => prev.filter(c => c.id !== deleteConfirm.id));
      }
    } else {
      const res = await fetch(`/api/v1/tenants/${tenant}/notification-rules/${deleteConfirm.id}`, {
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
    if (!token || !tenant) return;

    const res = await fetch(`/api/v1/tenants/${tenant}/notifications/channels/${id}`, {
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
      case 'email': return <Mail className="w-5 h-5" />;
      case 'sms': return <Smartphone className="w-5 h-5" />;
      case 'webhook': return <Webhook className="w-5 h-5" />;
      default: return <Bell className="w-5 h-5" />;
    }
  };

  return (
    <PageShell
      title="Notifications"
      subtitle="Configure notification channels and rules"
    >

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-th-default">
          <button
            onClick={() => setActiveTab('channels')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'channels'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-th-secondary hover:text-th-primary'
            }`}
          >
            Channels
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'rules'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-th-secondary hover:text-th-primary'
            }`}
          >
            Rules
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-th-secondary hover:text-th-primary'
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
                <h2 className="text-lg font-bold text-th-primary">Notification Channels</h2>
                <p className="text-sm text-th-secondary mt-0.5">Configure email, SMS, and webhook endpoints</p>
              </div>
              <button onClick={() => setShowNewChannelForm(true)} className={`${btn.primary} flex items-center gap-2`}>
                <Plus className="w-4 h-4" />Add Channel
              </button>
            </div>

            {showNewChannelForm && (
              <AddChannelForm
                tenant={tenant}
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
                tenant={tenant}
                onSuccess={() => {
                  setEditingChannel(null);
                  loadData();
                }}
                onCancel={() => setEditingChannel(null)}
              />
            )}

            {loading ? (
              <div className="gito-card p-12 text-center text-sm text-th-secondary">Loading channels...</div>
            ) : channels.length === 0 ? (
              <div className="gito-card p-12 text-center flex flex-col items-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 text-th-muted" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.15)' }}>
                  <Bell className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-th-primary mb-1.5">No notification channels configured</h3>
                <p className="text-sm text-th-secondary mb-5">Add an email, SMS, or webhook channel to receive alerts</p>
                <button onClick={() => setShowNewChannelForm(true)} className={`${btn.primary} flex items-center gap-2`}>
                  <Plus className="w-4 h-4" />Create First Channel
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {channels.map(channel => (
                  <div key={channel.id} className="gito-card p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-th-muted" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.15)' }}>
                          {getChannelTypeIcon(channel.channel_type)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="font-semibold text-th-primary capitalize">{channel.channel_type}</h3>
                            <Badge variant={channel.enabled ? 'success' : 'neutral'} label={channel.enabled ? 'Enabled' : 'Disabled'} size="sm" />
                          </div>
                          <p className="text-xs text-th-muted font-mono">{JSON.stringify(channel.config)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-4">
                        <button onClick={() => toggleChannel(channel.id, channel.enabled)} className={btn.icon} title={channel.enabled ? 'Disable' : 'Enable'}>
                          <span className="text-xs font-bold">{channel.enabled ? 'ON' : 'OFF'}</span>
                        </button>
                        <button onClick={() => setEditingChannel(channel)} className={btn.icon} title="Edit"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteConfirm({ type: 'channel', id: channel.id, name: channel.channel_type })} className={btn.iconDanger} title="Delete"><Trash2 className="w-4 h-4" /></button>
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
                <h2 className="text-lg font-bold text-th-primary">Notification Rules</h2>
                <p className="text-sm text-th-secondary mt-0.5">Link alert rules to notification channels</p>
              </div>
              <button onClick={() => setShowNewRuleForm(true)} className={`${btn.primary} flex items-center gap-2`}>
                <Plus className="w-4 h-4" />Add Rule
              </button>
            </div>

            {showNewRuleForm && (
              <AddNotificationRuleForm
                tenant={tenant}
                alertRules={alertRules}
                channels={channels}
                onSuccess={() => {
                  setShowNewRuleForm(false);
                  loadData();
                }}
                onCancel={() => setShowNewRuleForm(false)}
              />
            )}

            {loading ? (
              <div className="gito-card p-12 text-center text-sm text-th-secondary">Loading rules...</div>
            ) : rules.length === 0 ? (
              <div className="gito-card p-12 text-center text-sm text-th-secondary">
                No notification rules configured. Rules link alert rules to notification channels.
              </div>
            ) : (
              <div className="gito-card overflow-hidden">
                <div className="border-b border-[var(--color-border)] px-6 py-3 bg-panel">
                  <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-th-muted uppercase tracking-widest">
                    <div className="col-span-4">Alert Rule</div>
                    <div className="col-span-3">Channel</div>
                    <div className="col-span-3">Status</div>
                    <div className="col-span-2 text-right">Actions</div>
                  </div>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {rules.map(rule => {
                    const linkedAlert = alertRules.find(a => a.id === rule.alert_rule_id);
                    const linkedChannel = channels.find(c => c.id === rule.channel_id);
                    return (
                      <div key={rule.id} className="px-6 py-4 hover:bg-panel transition-colors">
                        <div className="grid grid-cols-12 gap-4 items-center">
                          <div className="col-span-4">
                            <p className="text-sm font-semibold text-th-primary">{linkedAlert?.name || rule.alert_rule_id.substring(0, 8)}</p>
                            {linkedAlert && <p className="text-xs text-th-muted">{linkedAlert.rule_type} · {linkedAlert.severity}</p>}
                          </div>
                          <div className="col-span-3">
                            <div className="flex items-center gap-2 text-th-muted">
                              {getChannelTypeIcon(linkedChannel?.channel_type || '')}
                              <span className="text-sm text-th-primary capitalize">{linkedChannel?.channel_type || rule.channel_id.substring(0, 8)}</span>
                            </div>
                          </div>
                          <div className="col-span-3">
                            <Badge variant={rule.enabled ? 'success' : 'neutral'} label={rule.enabled ? 'Enabled' : 'Disabled'} size="sm" />
                          </div>
                          <div className="col-span-2 flex justify-end">
                            <button onClick={() => setDeleteConfirm({ type: 'rule', id: rule.id, name: linkedAlert?.name || 'rule' })} className={btn.iconDanger} title="Delete"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-th-primary">Notification History</h2>
              <p className="text-sm text-th-secondary mt-1">Recent notifications sent to channels</p>
            </div>

            {loading ? (
              <div className="gito-card p-12 text-center text-sm text-th-secondary">Loading history...</div>
            ) : notifications.length === 0 ? (
              <div className="gito-card p-12 text-center text-sm text-th-secondary">No notifications sent yet</div>
            ) : (
              <div className="gito-card overflow-hidden">
                <div className="border-b border-[var(--color-border)] px-6 py-3 bg-panel">
                  <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-th-muted uppercase tracking-widest">
                    <div className="col-span-2">Event ID</div>
                    <div className="col-span-2">Channel</div>
                    <div className="col-span-3">Recipient</div>
                    <div className="col-span-2">Status</div>
                    <div className="col-span-3">Sent At</div>
                  </div>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {notifications.map(notif => (
                    <div key={notif.id} className="px-6 py-4 hover:bg-panel transition-colors">
                      <div className="grid grid-cols-12 gap-4 items-center">
                        <div className="col-span-2"><span className="text-xs font-mono text-th-secondary">{notif.alert_event_id?.substring(0, 8) || '—'}</span></div>
                        <div className="col-span-2"><span className="text-sm text-th-primary capitalize">{notif.channel_type || notif.channel_id?.substring(0, 8) || '—'}</span></div>
                        <div className="col-span-3"><span className="text-sm text-th-secondary">{notif.recipient || '—'}</span></div>
                        <div className="col-span-2">
                          <Badge
                            variant={notif.status === 'sent' ? 'success' : notif.status === 'failed' ? 'danger' : 'warning'}
                            label={notif.status.charAt(0).toUpperCase() + notif.status.slice(1)}
                            size="sm"
                          />
                        </div>
                        <div className="col-span-3"><span className="text-xs text-th-muted">{notif.sent_at ? new Date(notif.sent_at).toLocaleString() : '—'}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="gito-card p-6 max-w-md w-full">
              <h3 className="text-lg font-bold text-th-primary mb-1">Delete {deleteConfirm.type === 'channel' ? 'Channel' : 'Rule'}</h3>
              <p className="text-sm text-th-secondary mb-5">
                Are you sure you want to delete <span className="font-semibold text-th-primary">{deleteConfirm.name}</span>? This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteConfirm(null)} className={btn.secondary}>Cancel</button>
                <button onClick={confirmDelete} className={btn.danger}>Delete</button>
              </div>
            </div>
          </div>
        )}
    </PageShell>
  );
}

function AddChannelForm({ tenant, onSuccess, onCancel }: { tenant: string | null; onSuccess: () => void; onCancel: () => void }) {
  const [type, setType] = useState<'email' | 'webhook' | 'sms'>('email');
  const [config, setConfig] = useState<Record<string, any>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    const res = await fetch(`/api/v1/tenants/${tenant}/notifications/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel_type: type, config, enabled: true })
    });

    if (res.ok) {
      onSuccess();
    }
  };

  return (
    <div className="gito-card p-6 mb-6">
      <h3 className="text-lg font-bold text-th-primary mb-1">Add Notification Channel</h3>
      <p className="text-sm text-th-secondary mb-5">Configure an endpoint to receive alert notifications</p>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Channel Type</label>
            <select value={type} onChange={e => setType(e.target.value as 'email' | 'webhook' | 'sms')} className={input.select}>
              <option value="email">Email</option>
              <option value="webhook">Webhook</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          {type === 'email' && (
            <div>
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Email Address</label>
              <input type="email" value={config.email || ''} onChange={e => setConfig(prev => ({ ...prev, email: e.target.value }))} className={input.base} required />
            </div>
          )}
          {type === 'webhook' && (
            <div>
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Webhook URL</label>
              <input type="url" value={config.url || ''} onChange={e => setConfig(prev => ({ ...prev, url: e.target.value }))} className={input.base} required />
            </div>
          )}
          {type === 'sms' && (
            <div>
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Phone Number</label>
              <input type="tel" value={config.phone || ''} onChange={e => setConfig(prev => ({ ...prev, phone: e.target.value }))} className={input.base} required />
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className={btn.secondary}>Cancel</button>
          <button type="submit" className={btn.primary}>Add Channel</button>
        </div>
      </form>
    </div>
  );
}

function AddNotificationRuleForm({
  tenant, alertRules, channels, onSuccess, onCancel
}: {
  tenant: string | null;
  alertRules: AlertRule[];
  channels: NotificationChannel[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [alertRuleId, setAlertRuleId] = useState('');
  const [channelId, setChannelId] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant || !alertRuleId || !channelId) return;

    const res = await fetch(`/api/v1/tenants/${tenant}/notification-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ alert_rule_id: alertRuleId, channel_id: channelId, enabled: true })
    });

    if (res.ok) {
      onSuccess();
    } else {
      const err = await res.json();
      toast.error('Failed to create rule', err.detail || 'Unknown error');
    }
  };

  return (
    <div className="gito-card p-6 mb-6">
      <h3 className="text-lg font-bold text-th-primary mb-1">Add Notification Rule</h3>
      <p className="text-sm text-th-secondary mb-5">Link an alert rule to a notification channel</p>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Alert Rule</label>
            <select value={alertRuleId} onChange={e => setAlertRuleId(e.target.value)} className={input.select} required>
              <option value="">Select an alert rule...</option>
              {alertRules.map(ar => (<option key={ar.id} value={ar.id}>{ar.name} ({ar.rule_type} · {ar.severity})</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Notification Channel</label>
            <select value={channelId} onChange={e => setChannelId(e.target.value)} className={input.select} required>
              <option value="">Select a channel...</option>
              {channels.map(ch => (<option key={ch.id} value={ch.id}>{ch.channel_type} - {JSON.stringify(ch.config).substring(0, 40)}</option>))}
            </select>
          </div>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className={btn.secondary}>Cancel</button>
          <button type="submit" className={btn.primary}>Create Rule</button>
        </div>
      </form>
    </div>
  );
}

function EditChannelForm({ channel, tenant, onSuccess, onCancel }: { channel: NotificationChannel; tenant: string | null; onSuccess: () => void; onCancel: () => void }) {
  const [config, setConfig] = useState(channel.config);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    const res = await fetch(`/api/v1/tenants/${tenant}/notifications/channels/${channel.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ config })
    });

    if (res.ok) {
      onSuccess();
    }
  };

  return (
    <div className="gito-card p-6 mb-6">
      <h3 className="text-lg font-bold text-th-primary mb-1">Edit Channel</h3>
      <p className="text-sm text-th-secondary mb-5">Update channel configuration</p>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Type</label>
            <input type="text" value={channel.channel_type} disabled className={`${input.base} opacity-50`} />
          </div>
          {channel.channel_type === 'email' && (
            <div>
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Email</label>
              <input type="email" value={config.email || ''} onChange={e => setConfig(prev => ({ ...prev, email: e.target.value }))} className={input.base} />
            </div>
          )}
          {channel.channel_type === 'webhook' && (
            <div>
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">URL</label>
              <input type="url" value={config.url || ''} onChange={e => setConfig(prev => ({ ...prev, url: e.target.value }))} className={input.base} />
            </div>
          )}
          {channel.channel_type === 'sms' && (
            <div>
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Phone</label>
              <input type="tel" value={config.phone || ''} onChange={e => setConfig(prev => ({ ...prev, phone: e.target.value }))} className={input.base} />
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className={btn.secondary}>Cancel</button>
          <button type="submit" className={btn.primary}>Update Channel</button>
        </div>
      </form>
    </div>
  );
}
