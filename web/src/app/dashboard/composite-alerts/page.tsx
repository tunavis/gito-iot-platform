'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';

interface CompositeAlertRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  conditions: any[];
  logic: 'AND' | 'OR';
  severity: 'info' | 'warning' | 'critical';
  weight_score: number | null;
  created_at: string;
  updated_at: string;
}

interface PreviewResult {
  matching_alerts: number;
  sample_alerts: any[];
  evaluation_time_ms: number;
}

export default function CompositeAlertsPage() {
  const [rules, setRules] = useState<CompositeAlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewRuleForm, setShowNewRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState<CompositeAlertRule | null>(null);
  const [previewingRule, setPreviewingRule] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [filterEnabled, setFilterEnabled] = useState<boolean | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    setLoading(true);
    const res = await fetch('/api/v1/alert-rules/composite?page=1&per_page=100', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      const json = await res.json();
      const ruleList = Array.isArray(json.data) ? json.data : json;
      setRules(filterEnabled !== null ? ruleList.filter(r => r.enabled === filterEnabled) : ruleList);
    }

    setLoading(false);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const res = await fetch(`/api/v1/alert-rules/composite/${deleteConfirm.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      setRules(prev => prev.filter(r => r.id !== deleteConfirm.id));
    }
    setDeleteConfirm(null);
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const res = await fetch(`/api/v1/alert-rules/composite/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled: !enabled })
    });

    if (res.ok) {
      setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !enabled } : r));
    }
  };

  const previewRule = async (id: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    setPreviewingRule(id);
    const res = await fetch(`/api/v1/alert-rules/composite/${id}/preview`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      setPreviewResult(data);
    } else {
      setPreviewResult(null);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-700';
      case 'warning': return 'bg-orange-100 text-orange-700';
      default: return 'bg-blue-100 text-blue-700';
    }
  };

  const filteredRules = filterEnabled !== null ? rules.filter(r => r.enabled === filterEnabled) : rules;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Composite Alerts</h1>
          <p className="text-gray-600">Create multi-condition alert rules with AND/OR logic</p>
        </div>

        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setFilterEnabled(null)}
              className={`px-3 py-1 text-sm rounded ${
                filterEnabled === null ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700'
              }`}
            >
              All Rules
            </button>
            <button
              onClick={() => setFilterEnabled(true)}
              className={`px-3 py-1 text-sm rounded ${
                filterEnabled === true ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700'
              }`}
            >
              Enabled
            </button>
            <button
              onClick={() => setFilterEnabled(false)}
              className={`px-3 py-1 text-sm rounded ${
                filterEnabled === false ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700'
              }`}
            >
              Disabled
            </button>
          </div>
          <button
            onClick={() => setShowNewRuleForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
          >
            + Create Rule
          </button>
        </div>

        {showNewRuleForm && (
          <NewCompositeRuleForm
            onSuccess={() => {
              setShowNewRuleForm(false);
              loadRules();
            }}
            onCancel={() => setShowNewRuleForm(false)}
          />
        )}

        {editingRule && (
          <EditCompositeRuleForm
            rule={editingRule}
            onSuccess={() => {
              setEditingRule(null);
              loadRules();
            }}
            onCancel={() => setEditingRule(null)}
          />
        )}

        {loading ? (
          <div className="text-center py-8 text-gray-600">Loading rules...</div>
        ) : filteredRules.length === 0 ? (
          <div className="bg-white rounded border border-gray-200 p-12 text-center">
            <p className="text-gray-600 mb-4">No composite alert rules configured</p>
            <button
              onClick={() => setShowNewRuleForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create First Rule
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredRules.map(rule => (
              <div key={rule.id} className="bg-white rounded border border-gray-200 p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                    {rule.description && <p className="text-sm text-gray-600 mt-1">{rule.description}</p>}
                  </div>
                  <span className={`px-2 py-1 text-xs font-medium rounded ${getSeverityColor(rule.severity)}`}>
                    {rule.severity.charAt(0).toUpperCase() + rule.severity.slice(1)}
                  </span>
                </div>

                <div className="bg-gray-50 rounded p-3 mb-4">
                  <p className="text-xs text-gray-600 font-mono uppercase mb-2">Conditions ({rule.logic} logic)</p>
                  <ul className="space-y-1">
                    {Array.isArray(rule.conditions) && rule.conditions.length > 0 ? (
                      rule.conditions.map((cond, idx) => (
                        <li key={idx} className="text-xs text-gray-700">
                          • {JSON.stringify(cond).substring(0, 100)}...
                        </li>
                      ))
                    ) : (
                      <li className="text-xs text-gray-500">No conditions defined</li>
                    )}
                  </ul>
                </div>

                {rule.weight_score !== null && (
                  <div className="text-xs text-gray-600 mb-4">
                    Weight Score: <span className="font-semibold">{rule.weight_score}</span>
                  </div>
                )}

                <div className="flex gap-3 items-center">
                  <button
                    onClick={() => toggleRule(rule.id, rule.enabled)}
                    className={`px-3 py-1 text-xs font-medium rounded ${
                      rule.enabled
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    onClick={() => previewRule(rule.id)}
                    className="px-3 py-1 text-xs font-medium rounded bg-purple-50 text-purple-600 hover:bg-purple-100"
                  >
                    Preview
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
                </div>

                {previewingRule === rule.id && previewResult && (
                  <div className="mt-4 bg-blue-50 border border-blue-200 rounded p-3">
                    <p className="text-xs font-semibold text-blue-900 mb-2">
                      Preview Results: {previewResult.matching_alerts} alerts matched in {previewResult.evaluation_time_ms}ms
                    </p>
                    {previewResult.sample_alerts.length > 0 && (
                      <ul className="text-xs text-blue-800 space-y-1">
                        {previewResult.sample_alerts.slice(0, 3).map((alert, idx) => (
                          <li key={idx}>• Sample: {JSON.stringify(alert).substring(0, 80)}...</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
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
                Are you sure you want to delete this composite alert rule? 
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

function NewCompositeRuleForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('warning');
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [conditions, setConditions] = useState<any[]>([]);
  const [weightScore, setWeightScore] = useState<number | null>(null);

  const handleAddCondition = () => {
    setConditions([...conditions, { field: 'alert_type', operator: 'equals', value: '' }]);
  };

  const handleConditionChange = (idx: number, field: string, value: any) => {
    const newConditions = [...conditions];
    newConditions[idx] = { ...newConditions[idx], [field]: value };
    setConditions(newConditions);
  };

  const handleRemoveCondition = (idx: number) => {
    setConditions(conditions.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || conditions.length === 0) {
      alert('Please enter a name and at least one condition');
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const payload = {
      name,
      description,
      severity,
      logic,
      conditions,
      weight_score: weightScore
    };

    const res = await fetch('/api/v1/alert-rules/composite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      onSuccess();
    } else {
      alert('Failed to create rule');
    }
  };

  const getFieldLabel = (field: string) => {
    const labels: Record<string, string> = {
      alert_type: 'Alert Type',
      severity: 'Severity',
      device_id: 'Device ID',
      metric: 'Metric',
      temperature: 'Temperature',
      humidity: 'Humidity',
      battery: 'Battery Level'
    };
    return labels[field] || field;
  };

  const getOperatorSymbol = (operator: string) => {
    const symbols: Record<string, string> = {
      equals: '=',
      contains: '∋',
      gt: '>',
      gte: '≥',
      lt: '<',
      lte: '≤',
      neq: '≠'
    };
    return symbols[operator] || operator;
  };

  return (
    <div className="bg-white border border-gray-200 rounded p-6 mb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Create Composite Alert Rule</h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
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
              onChange={e => setSeverity(e.target.value as 'info' | 'warning' | 'critical')} 
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={2}
            placeholder="Optional description of this rule..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Combine Conditions With</label>
            <select 
              value={logic} 
              onChange={e => setLogic(e.target.value as 'AND' | 'OR')} 
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="AND">AND (all conditions must match)</option>
              <option value="OR">OR (any condition can match)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {logic === 'AND' 
                ? 'Alert triggers only when ALL conditions are true' 
                : 'Alert triggers when ANY condition is true'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Weight Score (optional)</label>
            <input
              type="number"
              value={weightScore ?? ''}
              onChange={e => setWeightScore(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="0-100"
              min="0"
              max="100"
            />
            <p className="text-xs text-gray-500 mt-1">Priority weight for scoring</p>
          </div>
        </div>

        {/* Conditions Builder */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-3">
            <label className="block text-sm font-semibold text-gray-900">Rule Logic</label>
            <button
              type="button"
              onClick={handleAddCondition}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              + Add Condition
            </button>
          </div>

          {conditions.length === 0 ? (
            <div className="bg-blue-50 border border-blue-200 rounded p-4 text-center">
              <p className="text-sm text-blue-700 font-medium">No conditions yet</p>
              <p className="text-xs text-blue-600 mt-1">Click "Add Condition" to start building your rule</p>
            </div>
          ) : (
            <div>
              {/* Conditions List */}
              <div className="space-y-3 mb-4">
                {conditions.map((cond, idx) => (
                  <div key={idx} className="relative">
                    {idx > 0 && (
                      <div className="absolute left-6 top-0 -translate-y-4 text-xs font-semibold text-gray-500 bg-white px-2">
                        {logic}
                      </div>
                    )}
                    <div className="flex gap-3 items-end bg-gray-50 p-4 rounded border border-gray-200 hover:border-gray-300 transition-colors">
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-600 block mb-1">Field</label>
                        <select
                          value={cond.field}
                          onChange={e => handleConditionChange(idx, 'field', e.target.value)}
                          className="w-full px-2.5 py-2 border border-gray-300 rounded text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="alert_type">Alert Type</option>
                          <option value="severity">Severity</option>
                          <option value="device_id">Device ID</option>
                          <option value="metric">Metric</option>
                          <option value="temperature">Temperature</option>
                          <option value="humidity">Humidity</option>
                          <option value="battery">Battery Level</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-600 block mb-1">Operator</label>
                        <select
                          value={cond.operator}
                          onChange={e => handleConditionChange(idx, 'operator', e.target.value)}
                          className="w-full px-2.5 py-2 border border-gray-300 rounded text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="equals">Equals (=)</option>
                          <option value="contains">Contains (∋)</option>
                          <option value="gt">Greater Than (&gt;)</option>
                          <option value="gte">Greater Than or Equal (≥)</option>
                          <option value="lt">Less Than (&lt;)</option>
                          <option value="lte">Less Than or Equal (≤)</option>
                          <option value="neq">Not Equal (≠)</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-600 block mb-1">Value</label>
                        <input
                          type="text"
                          value={cond.value}
                          onChange={e => handleConditionChange(idx, 'value', e.target.value)}
                          className="w-full px-2.5 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Value..."
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCondition(idx)}
                        className="px-3 py-2 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Visual Preview */}
              {conditions.length > 0 && (
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded p-4">
                  <p className="text-xs font-semibold text-blue-900 mb-2 uppercase tracking-wide">Rule Preview</p>
                  <div className="bg-white rounded p-3 text-sm font-mono text-gray-700 break-words">
                    {conditions.map((cond, idx) => (
                      <div key={idx}>
                        {idx > 0 && <div className="text-blue-600 font-semibold my-1">{logic}</div>}
                        <div className="text-gray-900">
                          {getFieldLabel(cond.field)} <span className="text-blue-600">{getOperatorSymbol(cond.operator)}</span> <span className="text-orange-600">"{cond.value || '?'}"</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4 border-t border-gray-200">
          <button 
            type="button" 
            onClick={onCancel} 
            className="px-4 py-2 text-sm font-medium border border-gray-300 rounded text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            disabled={!name.trim() || conditions.length === 0}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Create Rule
          </button>
        </div>
      </form>
    </div>
  );
}

function EditCompositeRuleForm({ rule, onSuccess, onCancel }: { rule: CompositeAlertRule; onSuccess: () => void; onCancel: () => void }) {
  const [name, setName] = useState(rule.name);
  const [description, setDescription] = useState(rule.description || '');
  const [severity, setSeverity] = useState(rule.severity);
  const [conditions, setConditions] = useState(rule.conditions || []);
  const [logic, setLogic] = useState(rule.logic);

  const handleAddCondition = () => {
    setConditions([...conditions, { field: 'alert_type', operator: 'equals', value: '' }]);
  };

  const handleConditionChange = (idx: number, field: string, value: any) => {
    const newConditions = [...conditions];
    newConditions[idx] = { ...newConditions[idx], [field]: value };
    setConditions(newConditions);
  };

  const handleRemoveCondition = (idx: number) => {
    setConditions(conditions.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const payload = {
      name,
      description,
      severity,
      logic,
      conditions
    };

    const res = await fetch(`/api/v1/alert-rules/composite/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      onSuccess();
    }
  };

  const getFieldLabel = (field: string) => {
    const labels: Record<string, string> = {
      alert_type: 'Alert Type',
      severity: 'Severity',
      device_id: 'Device ID',
      metric: 'Metric',
      temperature: 'Temperature',
      humidity: 'Humidity',
      battery: 'Battery Level'
    };
    return labels[field] || field;
  };

  const getOperatorSymbol = (operator: string) => {
    const symbols: Record<string, string> = {
      equals: '=',
      contains: '∋',
      gt: '>',
      gte: '≥',
      lt: '<',
      lte: '≤',
      neq: '≠'
    };
    return symbols[operator] || operator;
  };

  return (
    <div className="bg-white border border-gray-200 rounded p-6 mb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Edit Rule</h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
            <select 
              value={severity} 
              onChange={e => setSeverity(e.target.value as any)} 
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={2}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Combine Conditions With</label>
            <select 
              value={logic} 
              onChange={e => setLogic(e.target.value as 'AND' | 'OR')} 
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="AND">AND (all conditions must match)</option>
              <option value="OR">OR (any condition can match)</option>
            </select>
          </div>
        </div>

        {/* Conditions Builder */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-3">
            <label className="block text-sm font-semibold text-gray-900">Rule Logic</label>
            <button
              type="button"
              onClick={handleAddCondition}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              + Add Condition
            </button>
          </div>

          {conditions.length === 0 ? (
            <div className="bg-blue-50 border border-blue-200 rounded p-4 text-center">
              <p className="text-sm text-blue-700 font-medium">No conditions</p>
            </div>
          ) : (
            <div>
              {/* Conditions List */}
              <div className="space-y-3 mb-4">
                {conditions.map((cond, idx) => (
                  <div key={idx} className="relative">
                    {idx > 0 && (
                      <div className="absolute left-6 top-0 -translate-y-4 text-xs font-semibold text-gray-500 bg-white px-2">
                        {logic}
                      </div>
                    )}
                    <div className="flex gap-3 items-end bg-gray-50 p-4 rounded border border-gray-200 hover:border-gray-300 transition-colors">
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-600 block mb-1">Field</label>
                        <select
                          value={cond.field}
                          onChange={e => handleConditionChange(idx, 'field', e.target.value)}
                          className="w-full px-2.5 py-2 border border-gray-300 rounded text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="alert_type">Alert Type</option>
                          <option value="severity">Severity</option>
                          <option value="device_id">Device ID</option>
                          <option value="metric">Metric</option>
                          <option value="temperature">Temperature</option>
                          <option value="humidity">Humidity</option>
                          <option value="battery">Battery Level</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-600 block mb-1">Operator</label>
                        <select
                          value={cond.operator}
                          onChange={e => handleConditionChange(idx, 'operator', e.target.value)}
                          className="w-full px-2.5 py-2 border border-gray-300 rounded text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="equals">Equals (=)</option>
                          <option value="contains">Contains (∋)</option>
                          <option value="gt">Greater Than (&gt;)</option>
                          <option value="gte">Greater Than or Equal (≥)</option>
                          <option value="lt">Less Than (&lt;)</option>
                          <option value="lte">Less Than or Equal (≤)</option>
                          <option value="neq">Not Equal (≠)</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-600 block mb-1">Value</label>
                        <input
                          type="text"
                          value={cond.value}
                          onChange={e => handleConditionChange(idx, 'value', e.target.value)}
                          className="w-full px-2.5 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Value..."
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCondition(idx)}
                        className="px-3 py-2 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Visual Preview */}
              {conditions.length > 0 && (
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded p-4">
                  <p className="text-xs font-semibold text-blue-900 mb-2 uppercase tracking-wide">Rule Preview</p>
                  <div className="bg-white rounded p-3 text-sm font-mono text-gray-700 break-words">
                    {conditions.map((cond, idx) => (
                      <div key={idx}>
                        {idx > 0 && <div className="text-blue-600 font-semibold my-1">{logic}</div>}
                        <div className="text-gray-900">
                          {getFieldLabel(cond.field)} <span className="text-blue-600">{getOperatorSymbol(cond.operator)}</span> <span className="text-orange-600">"{cond.value || '?'}"</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4 border-t border-gray-200">
          <button 
            type="button" 
            onClick={onCancel} 
            className="px-4 py-2 text-sm font-medium border border-gray-300 rounded text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Update Rule
          </button>
        </div>
      </form>
    </div>
  );
}
