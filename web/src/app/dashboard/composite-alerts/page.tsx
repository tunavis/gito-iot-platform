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

  const deleteRule = async (id: string) => {
    if (!confirm('Delete this composite alert rule?')) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const res = await fetch(`/api/v1/alert-rules/composite/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      setRules(prev => prev.filter(r => r.id !== id));
    }
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
                    onClick={() => deleteRule(rule.id)}
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

  return (
    <div className="bg-white border border-gray-200 rounded p-6 mb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Create Composite Alert Rule</h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Rule Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="e.g., High Temperature Alert"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Severity</label>
            <select value={severity} onChange={e => setSeverity(e.target.value as 'info' | 'warning' | 'critical')} className="w-full px-3 py-2 border border-gray-300 rounded">
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm text-gray-600 mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            rows={2}
            placeholder="Optional description..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Logic</label>
            <select value={logic} onChange={e => setLogic(e.target.value as 'AND' | 'OR')} className="w-full px-3 py-2 border border-gray-300 rounded">
              <option value="AND">AND (all conditions must match)</option>
              <option value="OR">OR (any condition matches)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Weight Score (optional)</label>
            <input
              type="number"
              value={weightScore ?? ''}
              onChange={e => setWeightScore(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="0-100"
              min="0"
              max="100"
            />
          </div>
        </div>

        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm text-gray-600 font-semibold">Conditions</label>
            <button
              type="button"
              onClick={handleAddCondition}
              className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
            >
              + Add Condition
            </button>
          </div>

          {conditions.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center text-sm text-gray-600">
              No conditions added yet. Click "Add Condition" to start.
            </div>
          ) : (
            <div className="space-y-2">
              {conditions.map((cond, idx) => (
                <div key={idx} className="flex gap-2 items-end">
                  <select
                    value={cond.field}
                    onChange={e => handleConditionChange(idx, 'field', e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                  >
                    <option value="alert_type">Alert Type</option>
                    <option value="severity">Severity</option>
                    <option value="device_id">Device ID</option>
                    <option value="metric">Metric</option>
                  </select>
                  <select
                    value={cond.operator}
                    onChange={e => handleConditionChange(idx, 'operator', e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                  >
                    <option value="equals">Equals</option>
                    <option value="contains">Contains</option>
                    <option value="gt">Greater Than</option>
                    <option value="lt">Less Than</option>
                  </select>
                  <input
                    type="text"
                    value={cond.value}
                    onChange={e => handleConditionChange(idx, 'value', e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                    placeholder="Value"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveCondition(idx)}
                    className="px-2 py-1 text-xs text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const payload = {
      name,
      description,
      severity,
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

  return (
    <div className="bg-white border border-gray-200 rounded p-6 mb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Rule</h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Severity</label>
            <select value={severity} onChange={e => setSeverity(e.target.value as any)} className="w-full px-3 py-2 border border-gray-300 rounded">
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm text-gray-600 mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            rows={2}
          />
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Update Rule
          </button>
        </div>
      </form>
    </div>
  );
}
