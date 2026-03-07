'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import { formatMetricLabel } from '@/lib/formatMetricLabel';
import { Badge, SeverityBadge } from '@/components/ui/Badge';
import { btn, input } from '@/components/ui/buttonStyles';
import { Plus, Edit2, Trash2, Bell } from 'lucide-react';

// ============================================================================
// TYPES - Unified Alert Rules (THRESHOLD + COMPOSITE)
// ============================================================================

type RuleType = 'THRESHOLD' | 'COMPOSITE';
type Severity = 'info' | 'warning' | 'critical';
type ConditionLogic = 'AND' | 'OR';

interface AlertCondition {
  field: string;
  operator: string;
  threshold: number;
  weight: number;
}

interface AlertRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  rule_type: RuleType;
  severity: Severity;
  enabled: boolean;
  // THRESHOLD fields
  device_id: string | null;
  metric: string | null;
  operator: string | null;
  threshold: number | null;
  // COMPOSITE fields
  conditions: AlertCondition[] | null;
  logic: ConditionLogic | null;
  // Common
  cooldown_minutes: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Device {
  id: string;
  name: string;
  device_type_id?: string;
}

interface DeviceType {
  id: string;
  name: string;
  data_model?: Array<{ name: string; type?: string; unit?: string; description?: string }>;
  telemetry_schema?: Record<string, { type?: string; unit?: string; description?: string }>;
}

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
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

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

  const loadDevices = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token || !tenant) return;

    const [devRes, dtRes] = await Promise.all([
      fetch(`/api/v1/tenants/${tenant}/devices?page=1&per_page=500`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch(`/api/v1/tenants/${tenant}/device-types?per_page=100`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
    ]);

    if (devRes.ok) {
      const json = await devRes.json();
      setDevices(json.data || []);
    }
    if (dtRes.ok) {
      const json = await dtRes.json();
      setDeviceTypes(Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []));
    }
  }, [tenant]);

  useEffect(() => {
    if (tenant) {
      loadRules();
      loadDevices();
    }
  }, [tenant, loadRules, loadDevices]);

  const deleteRule = async () => {
    if (!deleteConfirm || !tenant) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules/${deleteConfirm.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      setRules(prev => prev.filter(r => r.id !== deleteConfirm.id));
    }
    setDeleteConfirm(null);
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

  const getOperatorSymbol = (op: string) => {
    const symbols: Record<string, string> = {
      gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠'
    };
    return symbols[op] || op;
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

              {/* Device Filter */}
              <div>
                <label className="block text-[10px] font-bold text-th-muted uppercase tracking-wider mb-1.5">Device</label>
                <select
                  value={filterDevice}
                  onChange={e => setFilterDevice(e.target.value)}
                  className={input.select}
                  style={{ width: 'auto' }}
                >
                  <option value="all">All Devices</option>
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
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

        {/* New Rule Form */}
        {showNewRuleForm && (
          <NewRuleForm
            tenant={tenant}
            devices={devices}
            deviceTypes={deviceTypes}
            onSuccess={() => {
              setShowNewRuleForm(false);
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
          <div className="gito-card p-12 text-center flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.15)' }}>
              <Bell className="w-7 h-7 text-th-muted" />
            </div>
            <h3 className="text-base font-bold text-th-primary mb-1.5">No alert rules configured</h3>
            <p className="text-sm text-th-secondary mb-5">Create your first rule to monitor device metrics</p>
            <button onClick={() => setShowNewRuleForm(true)} className={`${btn.primary} flex items-center gap-2`}>
              <Plus className="w-4 h-4" />Create First Rule
            </button>
          </div>
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
                    <button onClick={() => setDeleteConfirm({ id: rule.id, name: rule.name })} className={btn.iconDanger} title="Delete">
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
                        {formatMetricLabel(rule.metric || '')} {getOperatorSymbol(rule.operator || '')} {rule.threshold}
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
                            • {formatMetricLabel(cond.field)} {getOperatorSymbol(cond.operator)} {cond.threshold}
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
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="gito-card p-6 max-w-md w-full">
              <h3 className="text-lg font-bold text-th-primary mb-1">Delete Alert Rule</h3>
              <p className="text-sm text-th-secondary mb-5">
                Are you sure you want to delete{' '}
                <span className="font-semibold text-th-primary">&quot;{deleteConfirm.name}&quot;</span>?
                This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteConfirm(null)} className={btn.secondary}>Cancel</button>
                <button onClick={deleteRule} className={btn.danger}>Delete</button>
              </div>
            </div>
          </div>
        )}
    </PageShell>
  );
}


// ============================================================================
// NEW RULE FORM - Supports both THRESHOLD and COMPOSITE
// ============================================================================

// ── Schema helpers ────────────────────────────────────────────────────────────

type SchemaField = { type?: string; unit?: string; description?: string; min?: number; max?: number };
type Schema = Record<string, SchemaField>;

const NUMERIC_FIELD_TYPES = new Set(['float', 'integer', 'number']);

function getSchemaForDevice(deviceId: string, devices: Device[], deviceTypes: DeviceType[]): Schema {
  const schemaFromType = (dt: DeviceType): Schema => {
    if (dt.telemetry_schema) return dt.telemetry_schema as Schema;
    if (dt.data_model && Array.isArray(dt.data_model)) {
      return Object.fromEntries(
        dt.data_model.filter(f => f.name).map(f => [f.name, { type: f.type, unit: f.unit, description: f.description }])
      );
    }
    return {};
  };

  if (!deviceId) {
    // Global rule: merge all schemas
    const merged: Schema = {};
    deviceTypes.forEach(dt => Object.assign(merged, schemaFromType(dt)));
    return merged;
  }
  const device = devices.find(d => d.id === deviceId);
  if (!device?.device_type_id) return {};
  const dt = deviceTypes.find(t => t.id === device.device_type_id);
  return dt ? schemaFromType(dt) : {};
}

function getMetricsForDevice(
  deviceId: string,
  devices: Device[],
  deviceTypes: DeviceType[],
  numericOnly = false,
): string[] {
  const schema = getSchemaForDevice(deviceId, devices, deviceTypes);
  const keys = Object.keys(schema).sort();
  if (!numericOnly) return keys;
  return keys.filter(k => {
    const type = schema[k]?.type;
    return !type || NUMERIC_FIELD_TYPES.has(type); // include unknown-type fields (may be numeric)
  });
}

function NewRuleForm({
  tenant,
  devices,
  deviceTypes,
  onSuccess,
  onCancel
}: {
  tenant: string | null;
  devices: Device[];
  deviceTypes: DeviceType[];
  onSuccess: () => void;
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
      onSuccess();
    } else {
      const err = await res.json();
      toast.error('Failed to create rule', err.detail || 'Unknown error');
    }
  };

  return (
    <div className="bg-surface border border-th-default rounded-lg p-6 mb-6 shadow-sm">
      <h3 className="text-lg font-semibold text-th-primary mb-6">Create Alert Rule</h3>
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
              className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgfocus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="e.g., High Temperature Alert"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-th-primary mb-1">Severity</label>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value as Severity)}
              className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgfocus:ring-2 focus:ring-primary-500"
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
            className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgfocus:ring-2 focus:ring-primary-500"
            rows={2}
            placeholder="Optional description..."
          />
        </div>

        {/* THRESHOLD-specific fields */}
        {ruleType === 'THRESHOLD' && (
          <div className="bg-purple-50 border border-purple-200 rounded-lgp-4 mb-6">
            <h4 className="text-sm font-semibold text-purple-900 mb-3">Threshold Configuration</h4>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-th-primary mb-1">Device</label>
                <select
                  value={deviceId}
                  onChange={e => { setDeviceId(e.target.value); setMetric(''); }}
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgtext-sm"
                >
                  <option value="">Global (all devices)</option>
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
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
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgtext-sm"
                >
                  <option value="">Select metric...</option>
                  {availableMetrics.map(m => {
                    const s = deviceSchema[m];
                    return (
                      <option key={m} value={m}>
                        {s?.description || formatMetricLabel(m)}{s?.unit ? ` (${s.unit})` : ''}
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
                    className="w-full mt-1 px-3 py-2 border border-[var(--color-input-border)] rounded-lgtext-sm"
                    placeholder="Enter metric key"
                    required
                  />
                )}
                {/* Schema hint: unit + range */}
                {selectedMetricSchema && (
                  <p className="mt-1 text-xs text-purple-700">
                    {selectedMetricSchema.unit && <span className="font-medium">{selectedMetricSchema.unit}</span>}
                    {selectedMetricSchema.min !== undefined && selectedMetricSchema.max !== undefined && (
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
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgtext-sm"
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
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgtext-sm"
                  step="0.1"
                  placeholder={
                    selectedMetricSchema?.min !== undefined && selectedMetricSchema?.max !== undefined
                      ? `${selectedMetricSchema.min} – ${selectedMetricSchema.max}`
                      : undefined
                  }
                />
                {selectedMetricSchema?.min !== undefined && selectedMetricSchema?.max !== undefined && (
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
          <div className="bg-teal-50 border border-teal-200 rounded-lgp-4 mb-6">
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
                  className="px-3 py-1 text-xs font-medium bg-teal-600 text-white rounded-lghover:bg-teal-700"
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
                  <div key={idx} className="flex items-center gap-2 bg-surface p-2 rounded-lgborder">
                    <select
                      value={cond.field}
                      onChange={e => updateCondition(idx, { field: e.target.value })}
                      className="px-2 py-1 text-sm border border-[var(--color-input-border)] rounded-lg"
                    >
                      {allMetrics.map(m => {
                        const s = deviceSchema[m];
                        return (
                          <option key={m} value={m}>
                            {s?.description || formatMetricLabel(m)}{s?.unit ? ` (${s.unit})` : ''}
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
            className="px-4 py-2 text-sm font-medium border border-[var(--color-input-border)] rounded-lghover:bg-page"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lghover:bg-primary-700"
          >
            Create Rule
          </button>
        </div>
      </form>
    </div>
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
    <div className="bg-surface border border-th-default rounded-lg p-6 mb-6 shadow-sm">
      <h3 className="text-lg font-semibold text-th-primary mb-6">
        Edit {rule.rule_type} Rule
      </h3>
      <form onSubmit={handleSubmit}>
        {/* Common Fields */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-th-primary mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgfocus:ring-2 focus:ring-primary-500"
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
          <div className="bg-purple-50 border border-purple-200 rounded-lgp-4 mb-6">
            <h4 className="text-sm font-semibold text-purple-900 mb-3">Threshold Configuration</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-th-primary mb-1">Metric</label>
                <select
                  value={metric}
                  onChange={e => setMetric(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgtext-sm"
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
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgtext-sm"
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
                  className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lgtext-sm"
                  step="0.1"
                />
              </div>
            </div>
          </div>
        )}

        {/* COMPOSITE fields */}
        {rule.rule_type === 'COMPOSITE' && (
          <div className="bg-teal-50 border border-teal-200 rounded-lgp-4 mb-6">
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
                  className="px-3 py-1 text-xs font-medium bg-teal-600 text-white rounded-lghover:bg-teal-700"
                >
                  + Add Condition
                </button>
              </div>
            </div>
            
            <div className="space-y-2">
              {conditions.map((cond, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-surface p-2 rounded-lgborder">
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
            className="px-4 py-2 text-sm font-medium border border-[var(--color-input-border)] rounded-lghover:bg-page"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lghover:bg-primary-700"
          >
            Update Rule
          </button>
        </div>
      </form>
    </div>
  );
}
