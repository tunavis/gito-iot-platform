'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';

interface AlertRule {
  id: string;
  device_id: string | null;
  metric: string;
  operator: string;
  threshold: number;
  cooldown_minutes: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface Device {
  id: string;
  name: string;
}

export default function AlertRulesPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState<string>('all');
  const [showNewRule, setShowNewRule] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

      // Load devices
      const devRes = await fetch(`/api/v1/tenants/${tenant}/devices?page=1&per_page=100`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (devRes.ok) {
        const devJson = await devRes.json();
        setDevices(devJson.data || []);
      }

      // Load alert rules
      const url = selectedDevice === 'all' 
        ? `/api/v1/tenants/${tenant}/alert-rules` 
        : `/api/v1/tenants/${tenant}/alert-rules?device_id=${selectedDevice}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }});
      if (res.ok) {
        const json = await res.json();
        setRules(json.data || []);
      }
      setLoading(false);
    };
    loadData();
  }, [selectedDevice]);

  const toggleRule = async (ruleId: string, active: boolean) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ active })
    });
    if (res.ok) {
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, active } : r));
    }
  };

  const deleteRule = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this alert rule?')) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules/${ruleId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setRules(prev => prev.filter(r => r.id !== ruleId));
    }
  };

  const getDeviceName = (deviceId: string | null) => {
    if (!deviceId) return 'All Devices';
    const device = devices.find(d => d.id === deviceId);
    return device ? device.name : deviceId;
  };

  const operatorSymbol = (op: string) => {
    const map: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠' };
    return map[op] || op;
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Alert Rules</h1>
        <p className="text-sm text-gray-600">Configure automated alerts for device metrics</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Filter by Device</label>
              <select 
                value={selectedDevice} 
                onChange={e => setSelectedDevice(e.target.value)} 
                className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white"
              >
                <option value="all">All Devices</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button 
            onClick={() => setShowNewRule(!showNewRule)} 
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + New Alert Rule
          </button>
        </div>
      </div>

      {/* New Rule Form */}
      {showNewRule && (
        <NewAlertRuleForm 
          devices={devices}
          onCreated={(rule) => { 
            setRules(prev => [rule, ...prev]); 
            setShowNewRule(false); 
          }} 
          onCancel={() => setShowNewRule(false)} 
        />
      )}

      {/* Rules List */}
      <div className="bg-white rounded border border-gray-200">
        <div className="border-b border-gray-200 px-6 py-3">
          <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-gray-600 uppercase">
            <div className="col-span-3">Device</div>
            <div className="col-span-2">Metric</div>
            <div className="col-span-2">Condition</div>
            <div className="col-span-1">Cooldown</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
        </div>
        <div className="divide-y divide-gray-200">
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-gray-600">Loading...</div>
          ) : rules.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-600">
              No alert rules configured. Click &quot;New Alert Rule&quot; to create one.
            </div>
          ) : (
            rules.map(rule => (
              <div key={rule.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3">
                    {rule.device_id ? (
                      <Link href={`/dashboard/devices/${rule.device_id}`} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                        {getDeviceName(rule.device_id)}
                      </Link>
                    ) : (
                      <span className="text-sm text-gray-600">Global Rule</span>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm font-medium text-gray-900 uppercase">{rule.metric}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-gray-900">{operatorSymbol(rule.operator)} {rule.threshold}</span>
                  </div>
                  <div className="col-span-1">
                    <span className="text-sm text-gray-600">{rule.cooldown_minutes}m</span>
                  </div>
                  <div className="col-span-2">
                    <button 
                      onClick={() => toggleRule(rule.id, !rule.active)}
                      className={`px-2.5 py-1 text-xs font-medium rounded ${
                        rule.active 
                          ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {rule.active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                  <div className="col-span-2 flex gap-2 justify-end">
                    <button 
                      onClick={() => deleteRule(rule.id)}
                      className="px-3 py-1 text-xs font-medium rounded bg-red-50 text-red-600 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      </main>
    </div>
  );
}

function NewAlertRuleForm({ 
  devices, 
  onCreated, 
  onCancel 
}: { 
  devices: Device[]; 
  onCreated: (rule: AlertRule) => void; 
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    device_id: '',
    metric: 'temperature',
    operator: 'gt',
    threshold: 0,
    cooldown_minutes: 5
  });

  const create = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    
    const payload = {
      ...formData,
      device_id: formData.device_id || null
    };

    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const json = await res.json();
      onCreated(json.data);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded p-6 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Create New Alert Rule</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm text-gray-600 mb-1">Device</label>
          <select 
            value={formData.device_id} 
            onChange={e => setFormData(prev => ({ ...prev, device_id: e.target.value }))} 
            className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
          >
            <option value="">All Devices (Global Rule)</option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Metric</label>
          <select 
            value={formData.metric} 
            onChange={e => setFormData(prev => ({ ...prev, metric: e.target.value }))} 
            className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
          >
            <option value="temperature">Temperature</option>
            <option value="humidity">Humidity</option>
            <option value="battery">Battery</option>
            <option value="rssi">RSSI</option>
            <option value="pressure">Pressure</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Operator</label>
          <select 
            value={formData.operator} 
            onChange={e => setFormData(prev => ({ ...prev, operator: e.target.value }))} 
            className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
          >
            <option value="gt">&gt; Greater than</option>
            <option value="gte">≥ Greater or equal</option>
            <option value="lt">&lt; Less than</option>
            <option value="lte">≤ Less or equal</option>
            <option value="eq">= Equal</option>
            <option value="neq">≠ Not equal</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Threshold</label>
          <input 
            type="number" 
            value={formData.threshold} 
            onChange={e => setFormData(prev => ({ ...prev, threshold: parseFloat(e.target.value) || 0 }))} 
            className="w-full px-3 py-2 border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Cooldown (minutes)</label>
          <input 
            type="number" 
            value={formData.cooldown_minutes} 
            onChange={e => setFormData(prev => ({ ...prev, cooldown_minutes: parseInt(e.target.value) || 5 }))} 
            min="1"
            max="1440"
            className="w-full px-3 py-2 border border-gray-300 rounded"
          />
        </div>
      </div>
      <div className="flex gap-2 mt-6">
        <button 
          onClick={onCancel} 
          className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
        >
          Cancel
        </button>
        <button 
          onClick={create} 
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Create Alert Rule
        </button>
      </div>
    </div>
  );
}
