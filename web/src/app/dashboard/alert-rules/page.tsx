'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import { formatMetricLabel } from '@/lib/formatMetricLabel';
import { Badge, SeverityBadge } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import DevicePicker from '@/components/ui/DevicePicker';
import { btn, input } from '@/components/ui/buttonStyles';
import { operatorSymbol } from '@/components/flow/ruleGraph';
import type {
  AlertCondition,
  AlertRule,
  ConditionLogic,
  NotificationChannel,
  NotificationRule,
  RuleType,
  Severity,
} from '@/components/flow/ruleGraph';
import { getMetricsForDevice, getSchemaForDevice } from '@/lib/deviceSchema';
import type { Device, DeviceType, SchemaField } from '@/lib/deviceSchema';
import { Plus, Edit2, Trash2, Bell, List, Workflow } from 'lucide-react';

// Alert-rule types live in components/flow/ruleGraph so the canvas and these
// forms cannot drift apart on the shape of a rule.

// @xyflow/react is ~50KB gzipped — keep it out of the shared chunk.
const RuleCanvas = dynamic(() => import('@/components/flow/RuleCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-sm text-th-secondary">Loading canvas…</div>
  ),
});

// Helper to extract tenant_id from JWT token
function getTenantFromToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.tenant_id || null;
  } catch {
    return null;
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AlertRulesPage() {
  const toast = useToast();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<string | null>(null);
  
  // Filters
  const [filterType, setFilterType] = useState<RuleType | 'ALL'>('ALL');
  const [filterSeverity, setFilterSeverity] = useState<Severity | 'ALL'>('ALL');
  const [filterEnabled, setFilterEnabled] = useState<boolean | null>(null);
  const [filterDevice, setFilterDevice] = useState<string>('all');
  
  // Forms
  const [showNewRuleForm, setShowNewRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  // Canvas view — list stays the default so the forms are always reachable.
  const [view, setView] = useState<'list' | 'canvas'>('list');
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [notificationRules, setNotificationRules] = useState<NotificationRule[]>([]);

  useEffect(() => {
    const t = getTenantFromToken();
    setTenant(t);
  }, []);

  const loadRules = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    setLoading(true);
    
    // Build query params
    const params = new URLSearchParams({ page: '1', per_page: '100' });
    if (filterType !== 'ALL') params.append('rule_type', filterType);
    if (filterSeverity !== 'ALL') params.append('severity', filterSeverity);
    if (filterEnabled !== null) params.append('enabled', String(filterEnabled));
    if (filterDevice !== 'all') params.append('device_id', filterDevice);

    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      const json = await res.json();
      setRules(json.data || []);
    }

    setLoading(false);
  }, [tenant, filterType, filterSeverity, filterEnabled, filterDevice]);

  /** Merge devices into the cache without dropping ones already known.
   *
   *  `devices` is not "the tenant's devices" — the list endpoint caps per_page
   *  at 100, so on a real fleet it never could be. It is "devices this page has
   *  seen": the first page, anything a DevicePicker search returned, and the
   *  ones referenced by the loaded rules. getSchemaForDevice/getDeviceName look
   *  up here, so a device must survive in the cache after the search that found
   *  it has been replaced. */
  const rememberDevices = useCallback((incoming: Device[]) => {
    if (incoming.length === 0) return;
    setDevices(prev => {
      const byId = new Map(prev.map(d => [d.id, d]));
      incoming.forEach(d => byId.set(d.id, d));
      return [...byId.values()];
    });
  }, []);

  const loadDevices = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    const [devRes, dtRes] = await Promise.all([
      // Seed only. Small tenants get a full list for free; large ones reach the
      // rest through the picker's server-side search.
      fetch(`/api/v1/tenants/${tenant}/devices?page=1&per_page=100`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch(`/api/v1/tenants/${tenant}/device-types?per_page=100`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
    ]);

    if (devRes.ok) {
      const json = await devRes.json();
      rememberDevices(json.data || []);
    }
    if (dtRes.ok) {
      const json = await dtRes.json();
      setDeviceTypes(Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []));
    }
  }, [tenant, rememberDevices]);

  // Channel wiring — only the canvas needs it, so only the canvas pays for it.
  const loadWiring = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    const [chanRes, nrRes] = await Promise.all([
      fetch(`/api/v1/tenants/${tenant}/notifications/channels`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch(`/api/v1/tenants/${tenant}/notification-rules?page=1&per_page=100`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
    ]);

    if (chanRes.ok) {
      const json = await chanRes.json();
      setChannels(json.data || []);
    }
    if (nrRes.ok) {
      const json = await nrRes.json();
      setNotificationRules(json.data || []);
    }
  }, [tenant]);

  useEffect(() => {
    if (tenant) {
      loadRules();
      loadDevices();
    }
  }, [tenant, loadRules, loadDevices]);

  useEffect(() => {
    if (tenant && view === 'canvas') loadWiring();
  }, [tenant, view, loadWiring]);

  /** Resolve names for devices a rule points at but the seed page missed.
   *
   *  Without this a rule bound to device 101+ renders as a UUID fragment on its
   *  card and on the canvas. Distinct, still-unknown ids only — on a small
   *  tenant that is zero requests. `attemptedDeviceIds` stops a device that
   *  404s (deleted, or another tenant's) from being re-fetched on every render. */
  const attemptedDeviceIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    const known = new Set(devices.map(d => d.id));
    const missing = [...new Set(
      rules
        .map(r => r.device_id)
        .filter((id): id is string => !!id && !known.has(id) && !attemptedDeviceIds.current.has(id))
    )];
    if (missing.length === 0) return;
    missing.forEach(id => attemptedDeviceIds.current.add(id));

    let cancelled = false;
    void Promise.all(
      missing.map(id =>
        fetch(`/api/v1/tenants/${tenant}/devices/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    ).then(results => {
      if (cancelled) return;
      rememberDevices(results.filter(Boolean) as Device[]);
    });
    return () => { cancelled = true; };
  }, [rules, devices, tenant, rememberDevices]);

  const deleteRule = async (rule: AlertRule) => {
    const confirmed = await toast.confirm(
      `Are you sure you want to delete "${rule.name}"? This action cannot be undone.`,
      { title: 'Delete Alert Rule', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!confirmed || !tenant) return;

    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules/${rule.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      setRules(prev => prev.filter(r => r.id !== rule.id));
    }
  };

  const toggleRule = async (rule: AlertRule) => {
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled: !rule.enabled })
    });

    if (res.ok) {
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    }
  };

  const getDeviceName = (deviceId: string | null) => {
    if (!deviceId) return 'Global';
    const device = devices.find(d => d.id === deviceId);
    return device ? device.name : deviceId.substring(0, 8);
  };

  return (
    <PageShell
      title="Alert Rules"
      subtitle="Configure threshold and composite alert rules for your devices"
    >

        {/* Filters */}
        <div className="gito-card p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-end justify-between">
            <div className="flex flex-wrap gap-4 items-end">
              {/* Type Filter */}
              <div>
                <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1.5">Type</label>
                <div className="flex gap-1 p-1 bg-panel rounded-lg border border-[var(--color-border)]">
                  {(['ALL', 'THRESHOLD', 'COMPOSITE'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setFilterType(type)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        filterType === type
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-th-muted hover:text-th-primary'
                      }`}
                    >
                      {type === 'ALL' ? 'All' : type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Severity Filter */}
              <div>
                <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1.5">Severity</label>
                <div className="flex gap-1 p-1 bg-panel rounded-lg border border-[var(--color-border)]">
                  {(['ALL', 'critical', 'warning', 'info'] as const).map(sev => (
                    <button
                      key={sev}
                      onClick={() => setFilterSeverity(sev as Severity | 'ALL')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        filterSeverity === sev
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-th-muted hover:text-th-primary'
                      }`}
                    >
                      {sev === 'ALL' ? 'All' : sev.charAt(0).toUpperCase() + sev.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1.5">Status</label>
                <div className="flex gap-1 p-1 bg-panel rounded-lg border border-[var(--color-border)]">
                  {([null, true, false] as const).map((status, idx) => (
                    <button
                      key={idx}
                      onClick={() => setFilterEnabled(status)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        filterEnabled === status
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-th-muted hover:text-th-primary'
                      }`}
                    >
                      {status === null ? 'All' : status ? 'Enabled' : 'Disabled'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Device Filter — searched server-side; this list is not bounded
                  by what the seed page happened to return. */}
              <div style={{ minWidth: 240 }}>
                <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1.5">Device</label>
                <DevicePicker
                  tenant={tenant!}
                  value={filterDevice === 'all' ? '' : filterDevice}
                  selectedLabel={filterDevice === 'all' ? undefined : getDeviceName(filterDevice)}
                  emptyLabel="All Devices"
                  onChange={d => {
                    if (d) rememberDevices([d]);
                    setFilterDevice(d?.id ?? 'all');
                  }}
                />
              </div>
            </div>

            <div className="flex items-end gap-3">
              {/* View toggle — list is the default; the forms stay reachable. */}
              <div>
                <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1.5">View</label>
                <div className="flex gap-1 p-1 bg-panel rounded-lg border border-[var(--color-border)]">
                  {([
                    { key: 'list' as const, label: 'List', icon: <List className="w-3.5 h-3.5" /> },
                    { key: 'canvas' as const, label: 'Canvas', icon: <Workflow className="w-3.5 h-3.5" /> },
                  ]).map(({ key, label, icon }) => (
                    <button
                      key={key}
                      onClick={() => setView(key)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                        view === key ? 'bg-primary-600 text-white shadow-sm' : 'text-th-muted hover:text-th-primary'
                      }`}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setShowNewRuleForm(true)}
                className={`${btn.primary} flex items-center gap-2`}
              >
                <Plus className="w-4 h-4" />
                Create Rule
              </button>
            </div>
          </div>
        </div>

        {/* New Rule Form */}
        {showNewRuleForm && (
          <NewRuleForm
            tenant={tenant}
            devices={devices}
            deviceTypes={deviceTypes}
            rememberDevices={rememberDevices}
            onSuccess={(createdId) => {
              setShowNewRuleForm(false);
              // Land on the rule that was just created rather than leaving the
              // canvas on the previous one — otherwise creating from the canvas
              // looks like it did nothing.
              if (createdId) setSelectedRuleId(createdId);
              loadRules();
            }}
            onCancel={() => setShowNewRuleForm(false)}
          />
        )}

        {/* Edit Rule Form */}
        {editingRule && (
          <EditRuleForm
            tenant={tenant}
            devices={devices}
            deviceTypes={deviceTypes}
            rule={editingRule}
            onSuccess={() => {
              setEditingRule(null);
              loadRules();
            }}
            onCancel={() => setEditingRule(null)}
          />
        )}

        {/* Rules List */}
        {loading ? (
          <div className="gito-card p-12 text-center text-sm text-th-secondary">Loading rules...</div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={<Bell className="w-8 h-8" />}
            title="No alert rules configured"
            description="Create your first rule to monitor device metrics"
            action={{ label: 'Create First Rule', onClick: () => setShowNewRuleForm(true) }}
          />
        ) : (
          view === 'canvas' ? (
            (() => {
              const selectedRule = rules.find(r => r.id === selectedRuleId) ?? rules[0];
              return (
                <div className="gito-card flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 340px)', minHeight: 440 }}>
                  <div className="p-3 flex items-center gap-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <label className="text-xs text-th-muted">Rule</label>
                    <select
                      value={selectedRule.id}
                      onChange={e => setSelectedRuleId(e.target.value)}
                      className={input.select}
                      style={{ width: 'auto', minWidth: 260 }}
                    >
                      {rules.map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                    <span className="text-xs text-th-muted ml-auto">
                      Click a condition or the AND/OR pill to edit it · drag from the alarm to a channel to notify it · select an edge and press Delete to unwire
                    </span>
                  </div>

                  {/* min-h-0 gives the canvas a real height inside the flex column. */}
                  <div className="flex-1 min-h-0">
                    <RuleCanvas
                      key={selectedRule.id}
                      tenant={tenant!}
                      rule={selectedRule}
                      channels={channels}
                      notificationRules={notificationRules}
                      devices={devices}
                      deviceTypes={deviceTypes}
                      deviceName={selectedRule.device_id ? getDeviceName(selectedRule.device_id) : undefined}
                      onEditRule={() => setEditingRule(selectedRule)}
                      onCreateRule={() => setShowNewRuleForm(true)}
                      onWiringChanged={loadWiring}
                      onRuleChanged={loadRules}
                    />
                  </div>
                </div>
              );
            })()
          ) : (
          <div className="grid gap-4">
            {rules.map(rule => (
              <div key={rule.id} className="gito-card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-semibold text-th-primary">{rule.name}</h3>
                      <Badge
                        variant={rule.rule_type === 'THRESHOLD' ? 'purple' : 'info'}
                        label={rule.rule_type}
                        size="sm"
                      />
                      <SeverityBadge severity={rule.severity} />
                      <Badge
                        variant={rule.enabled ? 'success' : 'neutral'}
                        label={rule.enabled ? 'Enabled' : 'Disabled'}
                        size="sm"
                      />
                    </div>
                    {rule.description && <p className="text-sm text-th-secondary">{rule.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    <button
                      onClick={() => toggleRule(rule)}
                      className={btn.icon}
                      title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    >
                      <span className="text-xs font-medium">{rule.enabled ? 'ON' : 'OFF'}</span>
                    </button>
                    <button onClick={() => setEditingRule(rule)} className={btn.icon} title="Edit">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteRule(rule)} className={btn.iconDanger} title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Rule Details */}
                <div className="rounded-lg p-3 mb-3 text-sm" style={{ background: 'var(--color-page)', border: '1px solid var(--color-border)' }}>
                  {rule.rule_type === 'THRESHOLD' ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-th-muted text-xs">Device:</span>
                      {rule.device_id ? (
                        <Link href={`/dashboard/devices/${rule.device_id}`} className="font-medium text-primary-500 hover:text-primary-400 text-xs">
                          {getDeviceName(rule.device_id)}
                        </Link>
                      ) : (
                        <span className="text-xs text-th-muted">Global Rule</span>
                      )}
                      <span className="text-th-muted opacity-40">|</span>
                      <span className="font-mono text-xs font-medium text-th-primary">
                        {formatMetricLabel(rule.metric || '')} {operatorSymbol(rule.operator || '')} {rule.threshold}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <div className="text-[10px] font-bold text-th-muted uppercase tracking-wider mb-2">
                        Conditions ({rule.logic} logic)
                      </div>
                      <ul className="space-y-1">
                        {rule.conditions?.map((cond, idx) => (
                          <li key={idx} className="text-xs font-mono text-th-primary">
                            • {formatMetricLabel(cond.field)} {operatorSymbol(cond.operator)} {cond.threshold}
                            {cond.weight > 1 && <span className="text-th-muted ml-2">(weight: {cond.weight})</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex items-center">
                  <span className="text-xs text-th-muted">Cooldown: <span className="font-medium text-th-secondary">{rule.cooldown_minutes}m</span></span>
                </div>
              </div>
            ))}
          </div>
          )
        )}
    </PageShell>
  );
}


// ============================================================================
// NEW RULE FORM - Supports both THRESHOLD and COMPOSITE
// ============================================================================

function NewRuleForm({
  tenant,
  devices,
  deviceTypes,
  rememberDevices,
  onSuccess,
  onCancel
}: {
  tenant: string | null;
  devices: Device[];
  deviceTypes: DeviceType[];
  /** Cache a device the picker found, so its metric schema resolves. */
  rememberDevices: (devices: Device[]) => void;
  /** The new rule's id, so the canvas can switch to what was just created. */
  onSuccess: (createdId: string | null) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [ruleType, setRuleType] = useState<RuleType>('THRESHOLD');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('warning');
  const [cooldownMinutes, setCooldownMinutes] = useState(5);

  // THRESHOLD fields
  const [deviceId, setDeviceId] = useState('');
  const [metric, setMetric] = useState('');
  const [customMetric, setCustomMetric] = useState('');
  const [operator, setOperator] = useState('gt');
  const [threshold, setThreshold] = useState<number>(0);

  // COMPOSITE fields
  const [conditions, setConditions] = useState<AlertCondition[]>([]);
  const [logic, setLogic] = useState<ConditionLogic>('AND');

  // Threshold rules need numeric metrics; composite conditions show all fields
  const availableMetrics = getMetricsForDevice(deviceId, devices, deviceTypes, ruleType === 'THRESHOLD');
  const allMetrics = getMetricsForDevice(deviceId, devices, deviceTypes, false);
  const deviceSchema = getSchemaForDevice(deviceId, devices, deviceTypes);

  // Schema metadata for the currently selected threshold metric
  const selectedMetricSchema: SchemaField | undefined =
    metric && metric !== '__custom__' ? deviceSchema[metric] : undefined;

  const addCondition = () => {
    const defaultField = allMetrics[0] || 'temperature';
    setConditions([...conditions, { field: defaultField, operator: 'gt', threshold: 0, weight: 1 }]);
  };

  const updateCondition = (idx: number, updates: Partial<AlertCondition>) => {
    setConditions(conditions.map((c, i) => i === idx ? { ...c, ...updates } : c));
  };

  const removeCondition = (idx: number) => {
    setConditions(conditions.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    // Validation
    if (!name.trim()) {
      toast.warning('Validation', 'Please enter a rule name');
      return;
    }

    if (ruleType === 'COMPOSITE' && conditions.length === 0) {
      toast.warning('Validation', 'Please add at least one condition');
      return;
    }

    const payload: Record<string, unknown> = {
      name,
      description: description || null,
      rule_type: ruleType,
      severity,
      enabled: true,
      cooldown_minutes: cooldownMinutes,
    };

    if (ruleType === 'THRESHOLD') {
      payload.device_id = deviceId || null;
      payload.metric = metric === '__custom__' ? customMetric : metric;
      payload.operator = operator;
      payload.threshold = threshold;
    } else {
      payload.conditions = conditions;
      payload.logic = logic;
    }

    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      // The response is the created rule (the API returns data directly). A
      // parse failure is not worth failing the create over — the rule exists;
      // the canvas just stays where it was.
      const created = await res.json().catch(() => null);
      onSuccess(typeof created?.id === 'string' ? created.id : null);
    } else {
      const err = await res.json();
      toast.error('Failed to create rule', err.detail || 'Unknown error');
    }
  };

  return (
    // `scrollBody` because a composite rule with several conditions is taller
    // than the viewport; without it the panel would clip and the submit button
    // would be unreachable. Modal's own max-w-4xl caps the field width.
    <Modal open onClose={onCancel} title="Create Alert Rule" size="2xl" scrollBody>
      <form onSubmit={handleSubmit}>
        {/* Rule Type Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-th-primary mb-2">Rule Type</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="ruleType"
                value="THRESHOLD"
                checked={ruleType === 'THRESHOLD'}
                onChange={() => setRuleType('THRESHOLD')}
                className="text-primary-600"
              />
              <span className="text-sm font-medium">Threshold</span>
              <span className="text-xs text-th-secondary">(single metric)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="ruleType"
                value="COMPOSITE"
                checked={ruleType === 'COMPOSITE'}
                onChange={() => setRuleType('COMPOSITE')}
                className="text-primary-600"
              />
              <span className="text-sm font-medium">Composite</span>
              <span className="text-xs text-th-secondary">(multiple conditions)</span>
            </label>
          </div>
        </div>

        {/* Common Fields */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-th-primary mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="e.g., High Temperature Alert"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-th-primary mb-1">Severity</label>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value as Severity)}
              className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-th-primary mb-1">Description (optional)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg focus:ring-2 focus:ring-primary-500"
            rows={2}
            placeholder="Optional description..."
          />
        </div>

        {/* THRESHOLD-specific fields */}
        {ruleType === 'THRESHOLD' && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
            <h4 className="text-sm font-semibold text-purple-900 mb-3">Threshold Configuration</h4>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <DevicePicker
                  label="Device"
                  tenant={tenant!}
                  value={deviceId}
                  selectedLabel={devices.find(d => d.id === deviceId)?.name}
                  emptyLabel="Global (all devices)"
                  onChange={d => {
                    // Push the pick into the page's cache first: the metric list
                    // below resolves its schema via the device's device_type_id,
                    // and a searched-for device is not in the seeded list.
                    if (d) rememberDevices([d]);
                    setDeviceId(d?.id ?? '');
                    setMetric('');
                  }}
                />
              </div>
              <div>
                <label className="block text-sm text-th-primary mb-1">
                  Metric
                  {availableMetrics.length > 0 && (
                    <span className="ml-1 text-xs text-th-muted font-normal">(numeric only)</span>
                  )}
                </label>
                <select
                  value={metric}
                  onChange={e => { setMetric(e.target.value); if (e.target.value !== '__custom__') setCustomMetric(''); }}
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm"
                >
                  <option value="">Select metric...</option>
                  {availableMetrics.map(m => {
                    const s = deviceSchema[m];
                    return (
                      <option key={m} value={m}>
                        {formatMetricLabel(m, deviceSchema)}{s?.unit ? ` (${s.unit})` : ''}
                      </option>
                    );
                  })}
                  <option value="__custom__">Custom metric...</option>
                </select>
                {metric === '__custom__' && (
                  <input
                    type="text"
                    value={customMetric}
                    onChange={e => setCustomMetric(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm"
                    placeholder="Enter metric key"
                    required
                  />
                )}
                {/* Schema hint: unit + range */}
                {selectedMetricSchema && (
                  <p className="mt-1 text-xs text-purple-700">
                    {selectedMetricSchema.unit && <span className="font-medium">{selectedMetricSchema.unit}</span>}
                    {/* `!= null`: an unbounded data_model field stores min/max as null. */}
                    {selectedMetricSchema.min != null && selectedMetricSchema.max != null && (
                      <span className="ml-1 text-purple-500">
                        · range {selectedMetricSchema.min} – {selectedMetricSchema.max}
                      </span>
                    )}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm text-th-primary mb-1">Operator</label>
                <select
                  value={operator}
                  onChange={e => setOperator(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm"
                >
                  <option value="gt">&gt; Greater than</option>
                  <option value="gte">&ge; Greater or equal</option>
                  <option value="lt">&lt; Less than</option>
                  <option value="lte">&le; Less or equal</option>
                  <option value="eq">= Equal</option>
                  <option value="neq">&ne; Not equal</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-th-primary mb-1">
                  Threshold
                  {selectedMetricSchema?.unit && (
                    <span className="ml-1 text-xs text-th-muted font-normal">({selectedMetricSchema.unit})</span>
                  )}
                </label>
                <input
                  type="number"
                  value={threshold}
                  onChange={e => setThreshold(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm"
                  step="0.1"
                  placeholder={
                    selectedMetricSchema?.min != null && selectedMetricSchema?.max != null
                      ? `${selectedMetricSchema.min} – ${selectedMetricSchema.max}`
                      : undefined
                  }
                />
                {selectedMetricSchema?.min != null && selectedMetricSchema?.max != null && (
                  <p className="mt-1 text-xs text-th-muted">
                    Valid range: {selectedMetricSchema.min} – {selectedMetricSchema.max}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* COMPOSITE-specific fields */}
        {ruleType === 'COMPOSITE' && (
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-6">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-semibold text-teal-900">Conditions</h4>
              <div className="flex items-center gap-3">
                <select
                  value={logic}
                  onChange={e => setLogic(e.target.value as ConditionLogic)}
                  className="px-3 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                >
                  <option value="AND">AND (all must match)</option>
                  <option value="OR">OR (any can match)</option>
                </select>
                <button
                  type="button"
                  onClick={addCondition}
                  className="px-3 py-1 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                >
                  + Add Condition
                </button>
              </div>
            </div>
            
            {conditions.length === 0 ? (
              <p className="text-sm text-teal-700">Click &quot;Add Condition&quot; to start building your rule</p>
            ) : (
              <div className="space-y-2">
                {conditions.map((cond, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-surface p-2 rounded-lg border">
                    <select
                      value={cond.field}
                      onChange={e => updateCondition(idx, { field: e.target.value })}
                      className="px-2 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                    >
                      {allMetrics.map(m => {
                        const s = deviceSchema[m];
                        return (
                          <option key={m} value={m}>
                            {formatMetricLabel(m, deviceSchema)}{s?.unit ? ` (${s.unit})` : ''}
                          </option>
                        );
                      })}
                      {!allMetrics.includes(cond.field) && (
                        <option value={cond.field}>{formatMetricLabel(cond.field)}</option>
                      )}
                    </select>
                    <select
                      value={cond.operator}
                      onChange={e => updateCondition(idx, { operator: e.target.value })}
                      className="px-2 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                    >
                      <option value="gt">&gt;</option>
                      <option value="gte">&ge;</option>
                      <option value="lt">&lt;</option>
                      <option value="lte">&le;</option>
                      <option value="eq">=</option>
                      <option value="neq">&ne;</option>
                    </select>
                    <input
                      type="number"
                      value={cond.threshold}
                      onChange={e => updateCondition(idx, { threshold: parseFloat(e.target.value) })}
                      className="w-24 px-2 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                      step="0.1"
                    />
                    <span className="text-xs text-th-secondary">Weight:</span>
                    <input
                      type="number"
                      value={cond.weight}
                      onChange={e => updateCondition(idx, { weight: parseInt(e.target.value) || 1 })}
                      className="w-16 px-2 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                      min="1"
                      max="100"
                    />
                    <button
                      type="button"
                      onClick={() => removeCondition(idx)}
                      className="p-1 text-red-500 hover:text-red-700"
                    >
                      ✕
                    </button>
                    {idx < conditions.length - 1 && (
                      <span className="text-xs font-medium text-teal-600 ml-2">{logic}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Cooldown */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-th-primary mb-1">
            Cooldown (minutes)
          </label>
          <input
            type="number"
            value={cooldownMinutes}
            onChange={e => setCooldownMinutes(parseInt(e.target.value) || 5)}
            className="w-32 px-3 py-2 border border-[var(--color-input-border)] rounded-lg"
            min="1"
            max="1440"
          />
          <p className="text-xs text-th-secondary mt-1">Minimum time between alerts (1-1440 minutes)</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium border border-[var(--color-input-border)] rounded-lg hover:bg-page"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Create Rule
          </button>
        </div>
      </form>
    </Modal>
  );
}


// ============================================================================
// EDIT RULE FORM
// ============================================================================

function EditRuleForm({
  tenant,
  devices,
  deviceTypes,
  rule,
  onSuccess,
  onCancel
}: {
  tenant: string | null;
  devices: Device[];
  deviceTypes: DeviceType[];
  rule: AlertRule;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(rule.name);
  const [description, setDescription] = useState(rule.description || '');
  const [severity, setSeverity] = useState<Severity>(rule.severity);
  const [cooldownMinutes, setCooldownMinutes] = useState(rule.cooldown_minutes);

  // THRESHOLD fields
  const [metric, setMetric] = useState(rule.metric || '');
  const [operator, setOperator] = useState(rule.operator || 'gt');
  const [threshold, setThreshold] = useState<number>(rule.threshold || 0);

  // COMPOSITE fields
  const [conditions, setConditions] = useState<AlertCondition[]>(rule.conditions || []);
  const [logic, setLogic] = useState<ConditionLogic>(rule.logic || 'AND');

  const availableMetrics = getMetricsForDevice(rule.device_id || '', devices, deviceTypes);

  const addCondition = () => {
    const defaultField = availableMetrics[0] || 'temperature';
    setConditions([...conditions, { field: defaultField, operator: 'gt', threshold: 0, weight: 1 }]);
  };

  const updateCondition = (idx: number, updates: Partial<AlertCondition>) => {
    setConditions(conditions.map((c, i) => i === idx ? { ...c, ...updates } : c));
  };

  const removeCondition = (idx: number) => {
    setConditions(conditions.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    const payload: Record<string, unknown> = {
      name,
      description: description || null,
      severity,
      cooldown_minutes: cooldownMinutes,
    };

    if (rule.rule_type === 'THRESHOLD') {
      payload.metric = metric;
      payload.operator = operator;
      payload.threshold = threshold;
    } else {
      payload.conditions = conditions;
      payload.logic = logic;
    }

    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      onSuccess();
    } else {
      const err = await res.json();
      toast.error('Failed to update rule', err.detail || 'Unknown error');
    }
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title={`Edit ${rule.rule_type} Rule`}
      size="2xl"
      scrollBody
    >
      <form onSubmit={handleSubmit}>
        {/* Common Fields */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-th-primary mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-th-primary mb-1">Severity</label>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value as Severity)}
              className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-th-primary mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg"
            rows={2}
          />
        </div>

        {/* THRESHOLD fields */}
        {rule.rule_type === 'THRESHOLD' && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
            <h4 className="text-sm font-semibold text-purple-900 mb-3">Threshold Configuration</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-th-primary mb-1">Metric</label>
                <select
                  value={metric}
                  onChange={e => setMetric(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm"
                >
                  {availableMetrics.map(m => (
                    <option key={m} value={m}>{formatMetricLabel(m)}</option>
                  ))}
                  {metric && !availableMetrics.includes(metric) && (
                    <option value={metric}>{formatMetricLabel(metric)}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm text-th-primary mb-1">Operator</label>
                <select
                  value={operator}
                  onChange={e => setOperator(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm"
                >
                  <option value="gt">&gt; Greater than</option>
                  <option value="gte">&ge; Greater or equal</option>
                  <option value="lt">&lt; Less than</option>
                  <option value="lte">&le; Less or equal</option>
                  <option value="eq">= Equal</option>
                  <option value="neq">&ne; Not equal</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-th-primary mb-1">Threshold</label>
                <input
                  type="number"
                  value={threshold}
                  onChange={e => setThreshold(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm"
                  step="0.1"
                />
              </div>
            </div>
          </div>
        )}

        {/* COMPOSITE fields */}
        {rule.rule_type === 'COMPOSITE' && (
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-6">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-semibold text-teal-900">Conditions</h4>
              <div className="flex items-center gap-3">
                <select
                  value={logic}
                  onChange={e => setLogic(e.target.value as ConditionLogic)}
                  className="px-3 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                >
                  <option value="AND">AND (all must match)</option>
                  <option value="OR">OR (any can match)</option>
                </select>
                <button
                  type="button"
                  onClick={addCondition}
                  className="px-3 py-1 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                >
                  + Add Condition
                </button>
              </div>
            </div>
            
            <div className="space-y-2">
              {conditions.map((cond, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-surface p-2 rounded-lg border">
                  <select
                    value={cond.field}
                    onChange={e => updateCondition(idx, { field: e.target.value })}
                    className="px-2 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                  >
                    {availableMetrics.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    {!availableMetrics.includes(cond.field) && (
                      <option value={cond.field}>{cond.field}</option>
                    )}
                  </select>
                  <select
                    value={cond.operator}
                    onChange={e => updateCondition(idx, { operator: e.target.value })}
                    className="px-2 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                  >
                    <option value="gt">&gt;</option>
                    <option value="gte">&ge;</option>
                    <option value="lt">&lt;</option>
                    <option value="lte">&le;</option>
                    <option value="eq">=</option>
                    <option value="neq">&ne;</option>
                  </select>
                  <input
                    type="number"
                    value={cond.threshold}
                    onChange={e => updateCondition(idx, { threshold: parseFloat(e.target.value) })}
                    className="w-24 px-2 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                    step="0.1"
                  />
                  <span className="text-xs text-th-secondary">Weight:</span>
                  <input
                    type="number"
                    value={cond.weight}
                    onChange={e => updateCondition(idx, { weight: parseInt(e.target.value) || 1 })}
                    className="w-16 px-2 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                    min="1"
                    max="100"
                  />
                  <button
                    type="button"
                    onClick={() => removeCondition(idx)}
                    className="p-1 text-red-500 hover:text-red-700"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cooldown */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-th-primary mb-1">Cooldown (minutes)</label>
          <input
            type="number"
            value={cooldownMinutes}
            onChange={e => setCooldownMinutes(parseInt(e.target.value) || 5)}
            className="w-32 px-3 py-2 border border-[var(--color-input-border)] rounded-lg"
            min="1"
            max="1440"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium border border-[var(--color-input-border)] rounded-lg hover:bg-page"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Update Rule
          </button>
        </div>
      </form>
    </Modal>
  );
}
