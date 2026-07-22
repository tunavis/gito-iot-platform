'use client';

import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Download,
} from 'lucide-react';
import ProtocolSelector from '@/components/ProtocolSelector';
import ProtocolConfigForm from '@/components/ProtocolConfigForm';
import { btn, input } from '@/components/ui/buttonStyles';
import { useToast } from '@/components/ToastProvider';
import {
  CATEGORIES,
  CAPABILITIES,
  COLORS,
  ICON_OPTIONS,
  UNIT_SUGGESTIONS,
} from '../../_constants';
import type { DeviceTypeForm, DiscoveredMetric, UnifiedMetric, CommandDef } from '../../_types';
import { splitMetrics, mergeMetrics } from '../../_metrics';
import { VENDOR_PRESETS } from '../../_vendorPresets';
import DiscoveredMetricsPanel from './DiscoveredMetricsPanel';
import MetricsTable from './MetricsTable';
import CommandsTable from './CommandsTable';

interface DeviceTypeEditProps {
  form: DeviceTypeForm;
  setForm: (form: DeviceTypeForm) => void;
  error: string | null;
  isEditMode: boolean;
  discoveredMetrics: DiscoveredMetric[];
  discoveredTotal: number;
  discoveredLoading: boolean;
  onRefreshDiscovered: () => void;
}

export default function DeviceTypeEdit({
  form,
  setForm,
  error,
  isEditMode,
  discoveredMetrics,
  discoveredTotal,
  discoveredLoading,
  onRefreshDiscovered,
}: DeviceTypeEditProps) {
  const toast = useToast();
  const [expandedSections, setExpandedSections] = React.useState({
    basic: true,
    metrics: true,
    capabilities: true,
    commands: true,
    settings: false,
    connectivity: false,
  });
  const [showPresetMenu, setShowPresetMenu] = React.useState(false);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections({ ...expandedSections, [section]: !expandedSections[section] });
  };

  const loadVendorPreset = async (presetId: string) => {
    const preset = VENDOR_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setShowPresetMenu(false);

    if (form.metrics.length > 0) {
      const ok = await toast.confirm(
        `This replaces the ${form.metrics.length} metric(s) already defined with ${preset.vendor} ${preset.model}'s preset. This can't be undone.`,
        { title: 'Replace metrics with preset?', variant: 'danger', confirmLabel: 'Replace' }
      );
      if (!ok) return;
    }

    const metrics = mergeMetrics(preset.dataModel, { type: 'declarative', fields: preset.decoderFields }, {});
    setForm({
      ...form,
      metrics,
      manufacturer: preset.vendor,
      model: preset.model,
      category: preset.category,
      color: preset.color,
      icon: preset.icon,
      description: form.description || preset.description,
      connectivity: { ...form.connectivity, protocol: preset.protocol },
    });
    toast.success('Preset loaded', `${preset.vendor} ${preset.model} — ${metrics.length} metrics defined. Review and save.`);
  };

  const toggleCapability = (cap: string) => {
    setForm({
      ...form,
      capabilities: form.capabilities.includes(cap)
        ? form.capabilities.filter((c) => c !== cap)
        : [...form.capabilities, cap],
    });
  };

  const SectionHeader = ({
    sectionKey,
    title,
    badge,
  }: {
    sectionKey: keyof typeof expandedSections;
    title: string;
    badge?: string;
  }) => (
    <button
      type="button"
      onClick={() => toggleSection(sectionKey)}
      className="w-full px-6 py-4 flex items-center justify-between hover:bg-page transition-colors"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-th-primary">{title}</h2>
        {badge && (
          <span className="px-2 py-0.5 bg-panel rounded text-xs text-th-secondary font-medium">
            {badge}
          </span>
        )}
      </div>
      {expandedSections[sectionKey] ? (
        <ChevronUp className="w-5 h-5 text-th-muted" />
      ) : (
        <ChevronDown className="w-5 h-5 text-th-muted" />
      )}
    </button>
  );

  return (
    <div className="max-w-4xl space-y-6">
      {/* Shared autocomplete for the Unit fields in MetricsTable / CommandsTable —
          one instance since both editors can be open on this page at once. */}
      <datalist id="unit-suggestions">
        {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
      </datalist>

      {error && (
        <div
          className="p-4 rounded-lg flex items-center gap-2 text-sm"
          style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#ef4444' }}
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Basic Information */}
      <div className="gito-card overflow-hidden">
        <SectionHeader sectionKey="basic" title="Basic Information" />
        {expandedSections.basic && (
          <div className="px-6 pb-6 border-t border-th-default pt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-th-primary mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., Environmental Sensor"
                  className={input.base}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-th-primary mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className={input.select}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-th-primary mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe what this device type is used for..."
                rows={3}
                className={`${input.base} resize-none`}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-th-primary mb-1">Manufacturer</label>
                <input
                  type="text"
                  value={form.manufacturer}
                  onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                  placeholder="e.g., Acme Devices"
                  className={input.base}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-th-primary mb-1">Model</label>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="e.g., ES-100"
                  className={input.base}
                />
              </div>
            </div>

            {/* Color Picker */}
            <div>
              <label className="block text-sm font-medium text-th-primary mb-2">Color</label>
              <div className="flex gap-2">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setForm({ ...form, color })}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      form.color === color
                        ? 'border-th-primary scale-110 ring-2 ring-offset-2 ring-primary-400'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* Icon Picker */}
            <div>
              <label className="block text-sm font-medium text-th-primary mb-2">Icon</label>
              <div className="flex flex-wrap gap-2">
                {ICON_OPTIONS.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    title={label}
                    onClick={() => setForm({ ...form, icon: value })}
                    className={`w-9 h-9 rounded-lg border-2 flex items-center justify-center transition-all ${
                      form.icon === value
                        ? 'scale-110 ring-2 ring-offset-2 ring-primary-400'
                        : 'border-th-subtle hover:scale-105'
                    }`}
                    style={{
                      borderColor: form.icon === value ? form.color : undefined,
                      background: form.icon === value ? `${form.color}14` : undefined,
                      color: form.icon === value ? form.color : 'var(--color-text-secondary)',
                    }}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-panel peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-[var(--color-input-border)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
              </label>
              <span className="text-sm text-th-primary">Active</span>
            </div>
          </div>
        )}
      </div>

      {/* Metrics */}
      <div className="gito-card overflow-hidden">
        <SectionHeader sectionKey="metrics" title="Metrics" badge={`${form.metrics.length} defined`} />
        {expandedSections.metrics && (
          <div className="px-6 pb-6 border-t border-th-default pt-4 space-y-4">
            <div className="relative flex justify-end">
              <button
                type="button"
                onClick={() => setShowPresetMenu((v) => !v)}
                className={`${btn.secondary} flex items-center gap-2 text-sm`}
              >
                <Download className="w-3.5 h-3.5" />
                Load Vendor Preset
              </button>
              {showPresetMenu && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-surface border border-th-default rounded-lg shadow-lg z-10 py-1">
                  {VENDOR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => loadVendorPreset(preset.id)}
                      className="w-full px-3 py-2.5 text-left hover:bg-page transition-colors"
                    >
                      <p className="text-sm font-medium text-th-primary">{preset.vendor} {preset.model}</p>
                      <p className="text-xs text-th-muted mt-0.5">
                        {preset.category} · {preset.protocol.toUpperCase()} · {preset.dataModel.length} metrics
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <MetricsTable
              metrics={form.metrics}
              fPort={form.decoderFPort}
              onChange={(metrics: UnifiedMetric[]) => setForm({ ...form, metrics })}
              onFPortChange={(decoderFPort) => setForm({ ...form, decoderFPort })}
            />

            {/* Discovered Metrics — edit mode only */}
            {isEditMode && (
              <DiscoveredMetricsPanel
                metrics={discoveredMetrics}
                totalDevices={discoveredTotal}
                loading={discoveredLoading}
                onRefresh={onRefreshDiscovered}
                currentFieldNames={form.metrics.map((m) => m.name)}
                renameMap={splitMetrics(form.metrics).key_mapping}
                onAddField={(key) => {
                  setForm({
                    ...form,
                    metrics: [
                      ...form.metrics,
                      { name: key, type: 'float', unit: '', description: '', required: false, source: { mode: 'direct' } },
                    ],
                  });
                }}
                onMapField={(rawKey, canonical) => {
                  setForm({
                    ...form,
                    metrics: form.metrics.map((m) =>
                      m.name === canonical ? { ...m, source: { mode: 'rename', rawKey } } : m
                    ),
                  });
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Capabilities */}
      <div className="gito-card overflow-hidden">
        <SectionHeader sectionKey="capabilities" title="Capabilities" badge={`${form.capabilities.length} selected`} />
        {expandedSections.capabilities && (
          <div className="px-6 pb-6 border-t border-th-default pt-4">
            <p className="text-sm text-th-secondary mb-4">
              Select the capabilities this device type supports.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {CAPABILITIES.map((cap) => {
                const selected = form.capabilities.includes(cap.value);
                return (
                  <label
                    key={cap.value}
                    className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                    style={
                      selected
                        ? { background: 'rgba(37,99,235,0.06)', borderColor: 'rgba(37,99,235,0.3)' }
                        : { background: 'var(--color-surface)', borderColor: 'var(--color-border)' }
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleCapability(cap.value)}
                      className="mt-0.5 w-4 h-4 rounded border-[var(--color-input-border)] text-primary-600 focus:ring-primary-500"
                    />
                    <div>
                      <div className="text-sm font-medium text-th-primary">{cap.label}</div>
                      <div className="text-xs text-th-secondary">{cap.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Commands — only meaningful once the "commands" capability is on, but
          shown always so a definition can be prepared before enabling it. */}
      <div className="gito-card overflow-hidden">
        <SectionHeader sectionKey="commands" title="Commands" badge={`${form.commands.length} defined`} />
        {expandedSections.commands && (
          <div className="px-6 pb-6 border-t border-th-default pt-4 space-y-4">
            {!form.capabilities.includes('commands') && (
              <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                The &quot;Commands&quot; capability isn&apos;t enabled above — devices of this type
                won&apos;t be able to receive any commands defined here until it is.
              </div>
            )}
            <CommandsTable
              commands={form.commands}
              onChange={(commands: CommandDef[]) => setForm({ ...form, commands })}
            />
          </div>
        )}
      </div>

      {/* Default Settings */}
      <div className="gito-card overflow-hidden">
        <SectionHeader sectionKey="settings" title="Default Settings" />
        {expandedSections.settings && (
          <div className="px-6 pb-6 border-t border-th-default pt-4 space-y-4">
            <p className="text-sm text-th-secondary">
              Default operational settings for devices of this type. These can be overridden per device.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-th-primary mb-1">Heartbeat Interval (sec)</label>
                <input
                  type="number"
                  value={form.default_settings.heartbeat_interval}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      default_settings: { ...form.default_settings, heartbeat_interval: Number(e.target.value) },
                    })
                  }
                  className={input.base}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-th-primary mb-1">Telemetry Interval (sec)</label>
                <input
                  type="number"
                  value={form.default_settings.telemetry_interval}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      default_settings: { ...form.default_settings, telemetry_interval: Number(e.target.value) },
                    })
                  }
                  className={input.base}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-th-primary mb-1">Offline Threshold (sec)</label>
                <input
                  type="number"
                  value={form.default_settings.offline_threshold}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      default_settings: { ...form.default_settings, offline_threshold: Number(e.target.value) },
                    })
                  }
                  className={input.base}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Connectivity */}
      <div className="gito-card overflow-hidden">
        <SectionHeader sectionKey="connectivity" title="Connectivity" />
        {expandedSections.connectivity && (
          <div className="px-6 pb-6 border-t border-th-default pt-4 space-y-6">
            <p className="text-sm text-th-secondary">
              Configure the communication protocol and connection settings for devices of this type.
            </p>
            <ProtocolSelector
              value={form.connectivity.protocol}
              onChange={(protocol) => setForm({ ...form, connectivity: { ...form.connectivity, protocol } })}
            />
            <ProtocolConfigForm
              protocol={form.connectivity.protocol}
              config={form.connectivity}
              onChange={(connectivity) => setForm({ ...form, connectivity })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
