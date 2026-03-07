'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import {
  ArrowLeft, Plus, Cpu, Thermometer, Radio, ToggleRight, MapPin, Zap,
  Camera, Settings, Check, AlertCircle, ChevronRight, Tag,
  Network, Bolt, Info,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeviceType {
  id: string;
  name: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  category: string;
  icon: string;
  color: string;
  data_model?: { name: string; type: string }[];
  capabilities?: string[];
  connectivity?: { protocol?: string };
  telemetry_schema?: Record<string, unknown>;
}

interface Site        { id: string; name: string; organization_id: string }
interface DeviceGroup { id: string; name: string; site_id: string }

// ─── Protocol metadata ────────────────────────────────────────────────────────

const PROTOCOL_META: Record<string, { label: string; color: string }> = {
  mqtt:    { label: 'MQTT',      color: '#7c3aed' },
  http:    { label: 'HTTP REST', color: '#2563eb' },
  lorawan: { label: 'LoRaWAN',   color: '#059669' },
  modbus:  { label: 'Modbus',    color: '#d97706' },
  opcua:   { label: 'OPC-UA',    color: '#dc2626' },
  coap:    { label: 'CoAP',      color: '#0891b2' },
  zigbee:  { label: 'Zigbee',    color: '#65a30d' },
  nbiot:   { label: 'NB-IoT',    color: '#ea580c' },
};

const categoryIcons: Record<string, React.ReactNode> = {
  sensor:     <Thermometer className="w-5 h-5" />,
  gateway:    <Radio className="w-5 h-5" />,
  actuator:   <ToggleRight className="w-5 h-5" />,
  tracker:    <MapPin className="w-5 h-5" />,
  meter:      <Zap className="w-5 h-5" />,
  camera:     <Camera className="w-5 h-5" />,
  controller: <Settings className="w-5 h-5" />,
  other:      <Cpu className="w-5 h-5" />,
};

// ─── Dynamic steps ────────────────────────────────────────────────────────────
//
// MQTT / HTTP / unknown  →  Type → Info → Placement → Review   (4 steps)
// LoRaWAN                →  Type → Info → Network   → Placement → Review  (5 steps)

type StepId = 'select-type' | 'device-info' | 'network' | 'placement' | 'review';

const BASE_STEPS: { id: StepId; label: string }[] = [
  { id: 'select-type', label: 'Device Type' },
  { id: 'device-info', label: 'Identity'    },
  { id: 'placement',   label: 'Placement'   },
  { id: 'review',      label: 'Review'      },
];

const LORAWAN_STEPS: { id: StepId; label: string }[] = [
  { id: 'select-type', label: 'Device Type' },
  { id: 'device-info', label: 'Identity'    },
  { id: 'network',     label: 'Network'     },
  { id: 'placement',   label: 'Placement'   },
  { id: 'review',      label: 'Review'      },
];

// ─── Shared field styles ──────────────────────────────────────────────────────

const INPUT = [
  'w-full px-3.5 py-2.5 bg-surface border border-[var(--color-input-border)] rounded-lg',
  'text-sm text-th-primary placeholder-[var(--color-text-muted)]',
  'focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500',
  'transition-colors',
].join(' ');

// ─── Small components ─────────────────────────────────────────────────────────

function ProtocolBadge({ protocol }: { protocol?: string }) {
  const meta = PROTOCOL_META[protocol?.toLowerCase() ?? ''];
  if (!meta) return null;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: `${meta.color}12`, color: meta.color, border: `1px solid ${meta.color}22` }}>
      {meta.label}
    </span>
  );
}

function FormRow({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-th-primary mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-th-muted">{hint}</p>}
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-th-secondary flex-shrink-0">{label}</span>
      <span className={`text-sm text-th-primary text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

function StepBar({ steps, currentId }: { steps: { id: StepId; label: string }[]; currentId: StepId }) {
  const currentIndex = steps.findIndex(s => s.id === currentId);
  return (
    <div className="flex items-center gap-0 px-6 py-4 bg-surface border-b border-th-subtle">
      {steps.map((s, i) => {
        const done    = i < currentIndex;
        const current = i === currentIndex;
        return (
          <React.Fragment key={s.id}>
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all
                ${done    ? 'bg-emerald-500 text-white'
                : current ? 'bg-primary-600 text-white'
                :           'bg-panel text-th-muted'}`}>
                {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={`text-sm font-medium hidden sm:block ${
                current ? 'text-th-primary' : done ? 'text-emerald-600' : 'text-th-muted'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px mx-3 transition-colors ${i < currentIndex ? 'bg-emerald-300' : 'bg-panel'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewDevicePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [deviceTypes,   setDeviceTypes]   = useState<DeviceType[]>([]);
  const [sites,         setSites]         = useState<Site[]>([]);
  const [deviceGroups,  setDeviceGroups]  = useState<DeviceGroup[]>([]);

  const [selectedType,  setSelectedType]  = useState<DeviceType | null>(null);
  const [step,          setStep]          = useState<StepId>('select-type');

  const [info, setInfo] = useState({
    name: '', serial_number: '', description: '', tags: [] as string[], newTag: '',
  });
  const [network, setNetwork] = useState({
    dev_eui: '', app_key: '', ttn_app_id: '', mqtt_client_id: '',
  });
  const [placement, setPlacement] = useState({
    site_id: '', device_group_id: '', latitude: '', longitude: '',
  });

  // Protocol-aware step list
  const protocol = selectedType?.connectivity?.protocol?.toLowerCase() ?? 'mqtt';
  const steps    = useMemo(
    () => (protocol === 'lorawan' ? LORAWAN_STEPS : BASE_STEPS),
    [protocol],
  );
  const stepIndex   = steps.findIndex(s => s.id === step);
  const isLastStep  = stepIndex === steps.length - 1;

  // Fetch device types + sites
  const loadData = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) { router.push('/auth/login'); return; }
    const { tenant_id } = JSON.parse(atob(token.split('.')[1]));
    try {
      const [tr, sr] = await Promise.all([
        fetch(`/api/v1/tenants/${tenant_id}/device-types?is_active=true`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/v1/tenants/${tenant_id}/sites`,                        { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (tr.ok) setDeviceTypes((await tr.json()).data ?? []);
      if (sr.ok) setSites((await sr.json()).data ?? []);
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load groups when site changes
  useEffect(() => {
    if (!placement.site_id) { setDeviceGroups([]); return; }
    (async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const { tenant_id } = JSON.parse(atob(token.split('.')[1]));
      const r = await fetch(
        `/api/v1/tenants/${tenant_id}/device-groups?site_id=${placement.site_id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (r.ok) setDeviceGroups((await r.json()).data ?? []);
    })();
  }, [placement.site_id]);

  const canAdvance = () => {
    if (step === 'select-type') return !!selectedType;
    if (step === 'device-info') return info.name.trim().length > 0;
    return true;
  };

  const goNext = () => {
    if (!canAdvance()) return;
    setError(null);
    setStep(steps[stepIndex + 1].id);
  };

  const goBack = () => {
    if (stepIndex === 0) { router.back(); return; }
    setStep(steps[stepIndex - 1].id);
  };

  const handleCreate = async () => {
    if (!selectedType || !info.name.trim()) return;
    setSaving(true); setError(null);
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) { router.push('/auth/login'); return; }
      const { tenant_id } = JSON.parse(atob(token.split('.')[1]));

      const body: Record<string, unknown> = {
        name:           info.name.trim(),
        device_type_id: selectedType.id,
        device_type:    selectedType.name,
        ...(info.description   && { description:   info.description }),
        ...(info.serial_number && { serial_number: info.serial_number }),
        ...(info.tags.length   && { tags:           info.tags }),
        ...(placement.site_id         && { site_id:         placement.site_id }),
        ...(placement.device_group_id && { device_group_id: placement.device_group_id }),
        ...(placement.latitude        && { latitude:  parseFloat(placement.latitude)  }),
        ...(placement.longitude       && { longitude: parseFloat(placement.longitude) }),
      };

      if (protocol === 'lorawan') {
        if (network.dev_eui)    body.dev_eui    = network.dev_eui;
        if (network.app_key)    body.app_key    = network.app_key;
        if (network.ttn_app_id) body.ttn_app_id = network.ttn_app_id;
      } else if (network.mqtt_client_id) {
        body.mqtt_client_id = network.mqtt_client_id;
      }

      const res = await fetch(`/api/v1/tenants/${tenant_id}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail || 'Failed to create device');
      }

      const result = await res.json();
      const deviceId = result.data?.id ?? result.id ?? '';
      // Land directly on Settings tab so the user can immediately generate a token
      router.push(`/dashboard/devices/${deviceId}?tab=settings`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create device');
      setSaving(false);
    }
  };

  const addTag = () => {
    const t = info.newTag.trim();
    if (t && !info.tags.includes(t)) setInfo({ ...info, tags: [...info.tags, t], newTag: '' });
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen bg-page">
        <Sidebar />
        <main className="flex-1 ml-64 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-th-default border-t-primary-500 rounded-full animate-spin" />
        </main>
      </div>
    );
  }

  // ── Page ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-64">

        {/* Header */}
        <div className="bg-surface border-b border-th-default px-8 py-5">
          <div className="flex items-center gap-3 max-w-3xl">
            <button onClick={() => router.back()}
              className="p-1.5 rounded-lg text-th-muted hover:text-th-secondary hover:bg-panel transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-th-primary">Register New Device</h1>
              <p className="text-xs text-th-muted">Add a device to your fleet and start ingesting telemetry</p>
            </div>
          </div>
        </div>

        {/* Step bar */}
        <div className="max-w-3xl">
          <StepBar steps={steps} currentId={step} />
        </div>

        {/* Content */}
        <div className="px-8 py-8 max-w-3xl space-y-6">

          {error && (
            <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
              {error}
            </div>
          )}

          {/* ── STEP: Select Type ─────────────────────────────────────── */}
          {step === 'select-type' && (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-th-primary">What type of device are you registering?</h2>
                <p className="text-sm text-th-secondary mt-0.5">
                  The device type defines the telemetry schema and communication protocol.
                </p>
              </div>

              {deviceTypes.length === 0 ? (
                <div className="flex flex-col items-center py-16 bg-surface border border-dashed border-[var(--color-input-border)] rounded-xl text-center">
                  <Cpu className="w-10 h-10 text-gray-300 mb-3" />
                  <p className="text-sm font-medium text-th-secondary mb-1">No device types yet</p>
                  <p className="text-xs text-th-muted mb-5">Create a device type to define the telemetry schema first.</p>
                  <button onClick={() => router.push('/dashboard/device-types')}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg transition-colors">
                    <Plus className="w-4 h-4" /> Create Device Type
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {deviceTypes.map(dt => {
                    const selected   = selectedType?.id === dt.id;
                    const schemaKeys = dt.telemetry_schema
                      ? Object.keys(dt.telemetry_schema)
                      : (dt.data_model ?? []).map(f => f.name);

                    return (
                      <button key={dt.id} onClick={() => setSelectedType(dt)}
                        className={`p-4 text-left rounded-xl border transition-all ${
                          selected
                            ? 'bg-primary-50 border-primary-300 ring-2 ring-primary-100 shadow-sm'
                            : 'bg-surface border-th-default hover:border-[var(--color-input-border)] hover:shadow-sm'
                        }`}>
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: `${dt.color}15`, color: dt.color }}>
                            {categoryIcons[dt.category] ?? <Cpu className="w-5 h-5" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-th-primary">{dt.name}</span>
                              <ProtocolBadge protocol={dt.connectivity?.protocol} />
                            </div>
                            <p className="text-xs text-th-muted mt-0.5">
                              {dt.manufacturer ?? 'Generic'}{dt.model ? ` · ${dt.model}` : ''}
                            </p>
                            {dt.description && (
                              <p className="text-xs text-th-secondary mt-2 line-clamp-2">{dt.description}</p>
                            )}
                            {schemaKeys.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {schemaKeys.slice(0, 4).map(k => (
                                  <span key={k} className="px-1.5 py-0.5 bg-panel rounded text-[10px] text-th-secondary">{k}</span>
                                ))}
                                {schemaKeys.length > 4 && (
                                  <span className="px-1.5 py-0.5 bg-panel rounded text-[10px] text-th-muted">+{schemaKeys.length - 4} more</span>
                                )}
                              </div>
                            )}
                          </div>
                          {selected && (
                            <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ── STEP: Identity ────────────────────────────────────────── */}
          {step === 'device-info' && (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-th-primary">Device identity</h2>
                <p className="text-sm text-th-secondary mt-0.5">Name and label this device within your fleet.</p>
              </div>

              <div className="bg-surface border border-th-default rounded-xl shadow-sm divide-y divide-[var(--color-border-subtle)]">
                <div className="p-5 space-y-4">
                  <FormRow label="Device Name" required>
                    <input autoFocus type="text" value={info.name}
                      onChange={e => setInfo({ ...info, name: e.target.value })}
                      onKeyDown={e => e.key === 'Enter' && goNext()}
                      placeholder="e.g. Temp Sensor — Building A, Floor 3"
                      className={INPUT} />
                  </FormRow>

                  <FormRow label="Serial Number"
                    hint="Hardware serial from the device label — used for asset tracking.">
                    <input type="text" value={info.serial_number}
                      onChange={e => setInfo({ ...info, serial_number: e.target.value })}
                      placeholder="e.g. SN-2024-001234"
                      className={INPUT} />
                  </FormRow>
                </div>

                <div className="p-5 space-y-4">
                  <FormRow label="Description">
                    <textarea value={info.description}
                      onChange={e => setInfo({ ...info, description: e.target.value })}
                      placeholder="Purpose, location notes, maintenance contacts…"
                      rows={3} className={INPUT + ' resize-none'} />
                  </FormRow>

                  <FormRow label="Tags" hint="Press Enter or + to add. Useful for filtering and bulk operations.">
                    {info.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {info.tags.map(t => (
                          <span key={t}
                            className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-panel rounded-lg text-xs text-th-primary border border-th-default">
                            <Tag className="w-3 h-3 text-th-muted" />
                            {t}
                            <button onClick={() => setInfo({ ...info, tags: info.tags.filter(x => x !== t) })}
                              className="w-4 h-4 flex items-center justify-center text-th-muted hover:text-red-500 transition-colors rounded">
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input type="text" value={info.newTag}
                        onChange={e => setInfo({ ...info, newTag: e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                        placeholder="e.g. production, hvac, floor-2"
                        className={INPUT + ' flex-1'} />
                      <button type="button" onClick={addTag}
                        className="px-3 bg-panel hover:bg-panel border border-th-default rounded-lg text-th-secondary transition-colors">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </FormRow>
                </div>
              </div>
            </section>
          )}

          {/* ── STEP: Network (LoRaWAN only) ──────────────────────────── */}
          {step === 'network' && (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-th-primary">LoRaWAN network settings</h2>
                <p className="text-sm text-th-secondary mt-0.5">
                  OTAA join credentials for{' '}
                  <span className="font-medium text-th-primary">{selectedType?.name}</span>.
                  These must match your The Things Network or ChirpStack application.
                </p>
              </div>

              <div className="bg-surface border border-th-default rounded-xl shadow-sm p-5 space-y-4">
                <FormRow label="Device EUI (DevEUI)" required
                  hint="16-character hex identifier — printed on the device label.">
                  <input type="text" value={network.dev_eui}
                    onChange={e => setNetwork({ ...network, dev_eui: e.target.value.toUpperCase() })}
                    placeholder="70B3D57ED005XXXX"
                    className={INPUT + ' font-mono tracking-wide'} maxLength={16} />
                </FormRow>

                <FormRow label="Application Key (AppKey)" required
                  hint="32-character OTAA root key — keep this confidential.">
                  <input type="password" value={network.app_key}
                    onChange={e => setNetwork({ ...network, app_key: e.target.value })}
                    placeholder="32-character hex key"
                    className={INPUT + ' font-mono'} />
                </FormRow>

                <FormRow label="Application ID"
                  hint="Application ID from your TTN console or ChirpStack instance.">
                  <input type="text" value={network.ttn_app_id}
                    onChange={e => setNetwork({ ...network, ttn_app_id: e.target.value })}
                    placeholder="e.g. my-application-v3"
                    className={INPUT} />
                </FormRow>
              </div>

              <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                Ensure this device is registered in your TTN/ChirpStack application with the same DevEUI before it can join the network.
              </div>
            </section>
          )}

          {/* ── STEP: Placement ───────────────────────────────────────── */}
          {step === 'placement' && (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-th-primary">Placement</h2>
                <p className="text-sm text-th-secondary mt-0.5">Assign to a site and group for fleet organisation. All fields are optional.</p>
              </div>

              <div className="bg-surface border border-th-default rounded-xl shadow-sm divide-y divide-[var(--color-border-subtle)]">
                <div className="p-5 space-y-4">
                  <FormRow label="Site">
                    <select value={placement.site_id}
                      onChange={e => setPlacement({ ...placement, site_id: e.target.value, device_group_id: '' })}
                      className={INPUT}>
                      <option value="">No site assigned</option>
                      {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </FormRow>

                  {placement.site_id && (
                    <FormRow label="Device Group">
                      <select value={placement.device_group_id}
                        onChange={e => setPlacement({ ...placement, device_group_id: e.target.value })}
                        className={INPUT}>
                        <option value="">No group assigned</option>
                        {deviceGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </FormRow>
                  )}
                </div>

                <div className="p-5">
                  <p className="text-sm font-medium text-th-primary mb-1">GPS Coordinates
                    <span className="ml-2 text-xs font-normal text-th-muted">Optional — enables Map view</span>
                  </p>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <FormRow label="Latitude">
                      <input type="number" step="any" value={placement.latitude}
                        onChange={e => setPlacement({ ...placement, latitude: e.target.value })}
                        placeholder="-33.9249" className={INPUT + ' font-mono'} />
                    </FormRow>
                    <FormRow label="Longitude">
                      <input type="number" step="any" value={placement.longitude}
                        onChange={e => setPlacement({ ...placement, longitude: e.target.value })}
                        placeholder="18.4241" className={INPUT + ' font-mono'} />
                    </FormRow>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── STEP: Review ──────────────────────────────────────────── */}
          {step === 'review' && selectedType && (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-th-primary">Review & provision</h2>
                <p className="text-sm text-th-secondary mt-0.5">Confirm the configuration before creating the device.</p>
              </div>

              <div className="bg-surface border border-th-default rounded-xl shadow-sm overflow-hidden">

                {/* Device type header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-th-subtle">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: `${selectedType.color}15`, color: selectedType.color }}>
                      {categoryIcons[selectedType.category] ?? <Cpu className="w-5 h-5" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-th-primary">{selectedType.name}</span>
                        <ProtocolBadge protocol={selectedType.connectivity?.protocol} />
                      </div>
                      <p className="text-xs text-th-muted">
                        {selectedType.manufacturer ?? 'Generic'}{selectedType.model ? ` · ${selectedType.model}` : ''}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setStep('select-type')}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                    Change
                  </button>
                </div>

                {/* Summary fields */}
                <div className="px-5 py-4 space-y-0">
                  <SummaryRow label="Name"     value={info.name} />
                  {info.serial_number && <SummaryRow label="Serial"  value={info.serial_number} mono />}
                  {info.description   && <SummaryRow label="Notes"   value={info.description} />}

                  {protocol === 'lorawan' ? (
                    <>
                      <SummaryRow label="DevEUI"   value={network.dev_eui || '—'} mono />
                      {network.ttn_app_id && <SummaryRow label="TTN App" value={network.ttn_app_id} />}
                    </>
                  ) : (
                    <SummaryRow label="Auth method" value="Device Token (generated after creation)" />
                  )}

                  <SummaryRow label="Site"  value={sites.find(s => s.id === placement.site_id)?.name ?? 'Not assigned'} />
                  {placement.device_group_id && (
                    <SummaryRow label="Group" value={deviceGroups.find(g => g.id === placement.device_group_id)?.name ?? '—'} />
                  )}
                  {placement.latitude && placement.longitude && (
                    <SummaryRow label="Location" value={`${placement.latitude}, ${placement.longitude}`} mono />
                  )}
                  {info.tags.length > 0 && (
                    <div className="flex items-center justify-between py-2 border-b border-gray-50">
                      <span className="text-sm text-th-secondary">Tags</span>
                      <div className="flex flex-wrap gap-1 justify-end">
                        {info.tags.map(t => (
                          <span key={t} className="px-2 py-0.5 bg-panel rounded text-xs text-th-secondary">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Next steps — only for MQTT, inline in the review card */}
                {protocol !== 'lorawan' && (
                  <div className="mx-5 mb-5 flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg">
                    <Network className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-blue-700">After creation</p>
                      <p className="text-xs text-th-secondary mt-0.5">
                        Go to <span className="font-medium text-th-primary">Settings → Tokens</span> to generate an auth token.
                        Use it as the MQTT password in your firmware — no UUID configuration needed.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Navigation ────────────────────────────────────────────── */}
          <div className="flex items-center justify-between pt-6 border-t border-th-default">
            <button onClick={goBack}
              className="px-4 py-2.5 text-sm text-th-secondary hover:text-th-primary hover:bg-panel rounded-lg transition-colors">
              {stepIndex === 0 ? 'Cancel' : '← Back'}
            </button>

            {isLastStep ? (
              <button onClick={handleCreate} disabled={saving}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors">
                {saving
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Provisioning…</>
                  : <><Bolt className="w-4 h-4" /> Provision Device</>}
              </button>
            ) : (
              <button onClick={goNext} disabled={!canAdvance()}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-panel disabled:text-th-muted text-white text-sm font-medium rounded-lg shadow-sm transition-colors">
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
