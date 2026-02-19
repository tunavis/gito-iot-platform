'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { useToast } from '@/components/ToastProvider';

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
  data_model?: Array<{ name: string; type?: string; unit?: string }>;
  telemetry_schema?: Record<string, { type?: string; unit?: string }>;
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

  const getSeverityColor = (severity: Severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-700';
      case 'warning': return 'bg-orange-100 text-orange-700';
      default: return 'bg-blue-100 text-blue-700';
    }
  };

  const getTypeColor = (type: RuleType) => {
    return type === 'THRESHOLD' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700';
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
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Alert Rules</h1>
          <p className="text-gray-600">Configure threshold and composite alert rules for your devices</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            {/* Type Filter */}
            <div>
              <label className="block text-xs text-gray-600 mb-1">Type</label>
              <div className="flex gap-1">
                {(['ALL', 'THRESHOLD', 'COMPOSITE'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      filterType === type 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {type === 'ALL' ? 'All' : type}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Severity Filter */}
            <div>
              <label className="block text-xs text-gray-600 mb-1">Severity</label>
              <div className="flex gap-1">
                {(['ALL', 'critical', 'warning', 'info'] as const).map(sev => (
                  <button
                    key={sev}
                    onClick={() => setFilterSeverity(sev as Severity | 'ALL')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      filterSeverity === sev 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {sev === 'ALL' ? 'All' : sev.charAt(0).toUpperCase() + sev.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Status Filter */}
            <div>
              <label className="block text-xs text-gray-600 mb-1">Status</label>
              <div className="flex gap-1">
                {([null, true, false] as const).map((status, idx) => (
                  <button
                    key={idx}
                    onClick={() => setFilterEnabled(status)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      filterEnabled === status 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {status === null ? 'All' : status ? 'Enabled' : 'Disabled'}
                  </button>
                ))}
              </div>
            </div>

            {/* Device Filter */}
            <div>
              <label className="block text-xs text-gray-600 mb-1">Device</label>
              <select 
                value={filterDevice} 
                onChange={e => setFilterDevice(e.target.value)} 
                className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white"
              >
                <option value="all">All Devices</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="ml-auto">
              <button
                onClick={() => setShowNewRuleForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
              >
                + Create Rule
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
          <div className="text-center py-8 text-gray-600">Loading rules...</div>
        ) : rules.length === 0 ? (
          <div className="bg-white rounded border border-gray-200 p-12 text-center">
            <p className="text-gray-600 mb-4">No alert rules configured</p>
            <button
              onClick={() => setShowNewRuleForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create First Rule
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {rules.map(rule => (
              <div key={rule.id} className="bg-white rounded border border-gray-200 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${getTypeColor(rule.rule_type)}`}>
                        {rule.rule_type}
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${getSeverityColor(rule.severity)}`}>
                        {rule.severity}
                      </span>
                    </div>
                    {rule.description && <p className="text-sm text-gray-600">{rule.description}</p>}
                  </div>
                </div>

                {/* Rule Details */}
                <div className="bg-gray-50 rounded p-3 mb-3 text-sm">
                  {rule.rule_type === 'THRESHOLD' ? (
                    <div className="flex items-center gap-4">
                      <span className="text-gray-600">Device:</span>
                      {rule.device_id ? (
                        <Link href={`/dashboard/devices/${rule.device_id}`} className="font-medium text-blue-600 hover:text-blue-700">
                          {getDeviceName(rule.device_id)}
                        </Link>
                      ) : (
                        <span className="text-gray-600">Global Rule</span>
                      )}
                      <span className="text-gray-400">|</span>
                      <span className="font-medium text-gray-800">
                        {rule.metric} {getOperatorSymbol(rule.operator || '')} {rule.threshold}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <div className="text-xs text-gray-500 uppercase mb-2">
                        Conditions ({rule.logic} logic)
                      </div>
                      <ul className="space-y-1">
                        {rule.conditions?.map((cond, idx) => (
                          <li key={idx} className="text-gray-700">
                            • {cond.field} {getOperatorSymbol(cond.operator)} {cond.threshold}
                            {cond.weight > 1 && <span className="text-gray-500 ml-2">(weight: {cond.weight})</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleRule(rule)}
                    className={`px-3 py-1 text-xs font-medium rounded ${
                      rule.enabled
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    onClick={() => setEditingRule(rule)}
                    className="px-3 py-1 text-xs font-medium rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirm({ id: rule.id, name: rule.name })}
                    className="px-3 py-1 text-xs font-medium rounded bg-red-50 text-red-600 hover:bg-red-100"
                  >
                    Delete
                  </button>
                  <span className="ml-auto text-xs text-gray-500">
                    Cooldown: {rule.cooldown_minutes}m
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Deletion</h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete the alert rule{' '}
                <span className="font-medium text-gray-900">&quot;{deleteConfirm.name}&quot;</span>?
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteRule}
                  className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700"
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


// ============================================================================
// NEW RULE FORM - Supports both THRESHOLD and COMPOSITE
// ============================================================================

function getMetricsForDevice(deviceId: string, devices: Device[], deviceTypes: DeviceType[]): string[] {
  const extractMetrics = (dt: DeviceType): string[] => {
    // Prefer telemetry_schema (computed from backend), fallback to data_model array
    if (dt.telemetry_schema) return Object.keys(dt.telemetry_schema);
    if (dt.data_model && Array.isArray(dt.data_model)) {
      return dt.data_model.map(f => f.name).filter(Boolean);
    }
    return [];
  };

  if (!deviceId) {
    // Global rule: collect all metrics from all device types
    const allMetrics = new Set<string>();
    deviceTypes.forEach(dt => extractMetrics(dt).forEach(k => allMetrics.add(k)));
    return Array.from(allMetrics).sort();
  }
  const device = devices.find(d => d.id === deviceId);
  if (!device?.device_type_id) return [];
  const dt = deviceTypes.find(t => t.id === device.device_type_id);
  if (!dt) return [];
  return extractMetrics(dt).sort();
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

  const availableMetrics = getMetricsForDevice(deviceId, devices, deviceTypes);

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
    <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Create Alert Rule</h3>
      <form onSubmit={handleSubmit}>
        {/* Rule Type Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Rule Type</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="ruleType"
                value="THRESHOLD"
                checked={ruleType === 'THRESHOLD'}
                onChange={() => setRuleType('THRESHOLD')}
                className="text-blue-600"
              />
              <span className="text-sm font-medium">Threshold</span>
              <span className="text-xs text-gray-500">(single metric)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="ruleType"
                value="COMPOSITE"
                checked={ruleType === 'COMPOSITE'}
                onChange={() => setRuleType('COMPOSITE')}
                className="text-blue-600"
              />
              <span className="text-sm font-medium">Composite</span>
              <span className="text-xs text-gray-500">(multiple conditions)</span>
            </label>
          </div>
        </div>

        {/* Common Fields */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., High Temperature Alert"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value as Severity)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            rows={2}
            placeholder="Optional description..."
          />
        </div>

        {/* THRESHOLD-specific fields */}
        {ruleType === 'THRESHOLD' && (
          <div className="bg-purple-50 border border-purple-200 rounded p-4 mb-6">
            <h4 className="text-sm font-semibold text-purple-900 mb-3">Threshold Configuration</h4>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">Device</label>
                <select
                  value={deviceId}
                  onChange={e => { setDeviceId(e.target.value); setMetric(''); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="">Global (all devices)</option>
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Metric</label>
                <select
                  value={metric}
                  onChange={e => { setMetric(e.target.value); if (e.target.value !== '__custom__') setCustomMetric(''); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="">Select metric...</option>
                  {availableMetrics.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">Custom metric...</option>
                </select>
                {metric === '__custom__' && (
                  <input
                    type="text"
                    value={customMetric}
                    onChange={e => setCustomMetric(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded text-sm"
                    placeholder="Enter metric key"
                    required
                  />
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Operator</label>
                <select
                  value={operator}
                  onChange={e => setOperator(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
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
                <label className="block text-sm text-gray-700 mb-1">Threshold</label>
                <input
                  type="number"
                  value={threshold}
                  onChange={e => setThreshold(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  step="0.1"
                />
              </div>
            </div>
          </div>
        )}

        {/* COMPOSITE-specific fields */}
        {ruleType === 'COMPOSITE' && (
          <div className="bg-teal-50 border border-teal-200 rounded p-4 mb-6">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-semibold text-teal-900">Conditions</h4>
              <div className="flex items-center gap-3">
                <select
                  value={logic}
                  onChange={e => setLogic(e.target.value as ConditionLogic)}
                  className="px-3 py-1 text-sm border border-gray-300 rounded"
                >
                  <option value="AND">AND (all must match)</option>
                  <option value="OR">OR (any can match)</option>
                </select>
                <button
                  type="button"
                  onClick={addCondition}
                  className="px-3 py-1 text-xs font-medium bg-teal-600 text-white rounded hover:bg-teal-700"
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
                  <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded border">
                    <select
                      value={cond.field}
                      onChange={e => updateCondition(idx, { field: e.target.value })}
                      className="px-2 py-1 text-sm border border-gray-300 rounded"
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
                      className="px-2 py-1 text-sm border border-gray-300 rounded"
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
                      className="w-24 px-2 py-1 text-sm border border-gray-300 rounded"
                      step="0.1"
                    />
                    <span className="text-xs text-gray-500">Weight:</span>
                    <input
                      type="number"
                      value={cond.weight}
                      onChange={e => updateCondition(idx, { weight: parseInt(e.target.value) || 1 })}
                      className="w-16 px-2 py-1 text-sm border border-gray-300 rounded"
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Cooldown (minutes)
          </label>
          <input
            type="number"
            value={cooldownMinutes}
            onChange={e => setCooldownMinutes(parseInt(e.target.value) || 5)}
            className="w-32 px-3 py-2 border border-gray-300 rounded"
            min="1"
            max="1440"
          />
          <p className="text-xs text-gray-500 mt-1">Minimum time between alerts (1-1440 minutes)</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
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
    <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">
        Edit {rule.rule_type} Rule
      </h3>
      <form onSubmit={handleSubmit}>
        {/* Common Fields */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value as Severity)}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded"
            rows={2}
          />
        </div>

        {/* THRESHOLD fields */}
        {rule.rule_type === 'THRESHOLD' && (
          <div className="bg-purple-50 border border-purple-200 rounded p-4 mb-6">
            <h4 className="text-sm font-semibold text-purple-900 mb-3">Threshold Configuration</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">Metric</label>
                <select
                  value={metric}
                  onChange={e => setMetric(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  {availableMetrics.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  {metric && !availableMetrics.includes(metric) && (
                    <option value={metric}>{metric}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">Operator</label>
                <select
                  value={operator}
                  onChange={e => setOperator(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
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
                <label className="block text-sm text-gray-700 mb-1">Threshold</label>
                <input
                  type="number"
                  value={threshold}
                  onChange={e => setThreshold(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  step="0.1"
                />
              </div>
            </div>
          </div>
        )}

        {/* COMPOSITE fields */}
        {rule.rule_type === 'COMPOSITE' && (
          <div className="bg-teal-50 border border-teal-200 rounded p-4 mb-6">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-semibold text-teal-900">Conditions</h4>
              <div className="flex items-center gap-3">
                <select
                  value={logic}
                  onChange={e => setLogic(e.target.value as ConditionLogic)}
                  className="px-3 py-1 text-sm border border-gray-300 rounded"
                >
                  <option value="AND">AND (all must match)</option>
                  <option value="OR">OR (any can match)</option>
                </select>
                <button
                  type="button"
                  onClick={addCondition}
                  className="px-3 py-1 text-xs font-medium bg-teal-600 text-white rounded hover:bg-teal-700"
                >
                  + Add Condition
                </button>
              </div>
            </div>
            
            <div className="space-y-2">
              {conditions.map((cond, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded border">
                  <select
                    value={cond.field}
                    onChange={e => updateCondition(idx, { field: e.target.value })}
                    className="px-2 py-1 text-sm border border-gray-300 rounded"
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
                    className="px-2 py-1 text-sm border border-gray-300 rounded"
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
                    className="w-24 px-2 py-1 text-sm border border-gray-300 rounded"
                    step="0.1"
                  />
                  <span className="text-xs text-gray-500">Weight:</span>
                  <input
                    type="number"
                    value={cond.weight}
                    onChange={e => updateCondition(idx, { weight: parseInt(e.target.value) || 1 })}
                    className="w-16 px-2 py-1 text-sm border border-gray-300 rounded"
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Cooldown (minutes)</label>
          <input
            type="number"
            value={cooldownMinutes}
            onChange={e => setCooldownMinutes(parseInt(e.target.value) || 5)}
            className="w-32 px-3 py-2 border border-gray-300 rounded"
            min="1"
            max="1440"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Update Rule
          </button>
        </div>
      </form>
    </div>
  );
}
