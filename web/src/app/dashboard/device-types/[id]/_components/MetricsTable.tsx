'use client';

import React from 'react';
import { Plus, Trash2, Binary, KeyRound, Radio } from 'lucide-react';
import { btn } from '@/components/ui/buttonStyles';
import { FIELD_TYPES, DECODER_FIELD_TYPES } from '../../_constants';
import type { UnifiedMetric, MetricSource, DecoderField } from '../../_types';

/**
 * Card-per-metric editor. Each metric is defined ONCE — its schema (name, type,
 * unit, description) plus how it arrives (Direct / Decode from bytes / Rename a
 * raw key). Replaces the old two-table Data Model + Payload Decoder split.
 */

interface MetricsTableProps {
  metrics: UnifiedMetric[];
  fPort: number | null;
  onChange: (metrics: UnifiedMetric[]) => void;
  onFPortChange: (fPort: number | null) => void;
}

const BYTE_LEN: Record<DecoderField['type'], number> = {
  uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, float32: 4,
  bcd: 4, // packed decimal has no fixed size — 4 bytes (8 digits) covers the common counter case, freely editable
};

const NEW_METRIC: UnifiedMetric = {
  name: '', type: 'float', unit: '', description: '', required: false, source: { mode: 'direct' },
};

const inputCls =
  'px-2.5 py-1.5 border border-[var(--color-input-border)] rounded-md text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500';

const SOURCE_TABS: Array<{ mode: MetricSource['mode']; label: string; icon: React.ReactNode }> = [
  { mode: 'direct', label: 'Sent as-is', icon: <Radio className="w-3.5 h-3.5" /> },
  { mode: 'decode', label: 'Decode bytes', icon: <Binary className="w-3.5 h-3.5" /> },
  { mode: 'rename', label: 'Rename key', icon: <KeyRound className="w-3.5 h-3.5" /> },
];

export default function MetricsTable({ metrics, fPort, onChange, onFPortChange }: MetricsTableProps) {
  const anyDecode = metrics.some((m) => m.source.mode === 'decode');

  const update = (i: number, patch: Partial<UnifiedMetric>) => {
    const next = [...metrics];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const setSource = (i: number, mode: MetricSource['mode']) => {
    let source: MetricSource;
    if (mode === 'decode') {
      source = { mode: 'decode', offset: 0, length: 2, byteType: 'uint16', endian: 'big', scale: 1, value_offset: 0 };
    } else if (mode === 'rename') {
      source = { mode: 'rename', rawKey: '' };
    } else {
      source = { mode: 'direct' };
    }
    update(i, { source });
  };

  const updateDecode = (i: number, patch: Partial<Extract<MetricSource, { mode: 'decode' }>>) => {
    const m = metrics[i];
    if (m.source.mode !== 'decode') return;
    update(i, { source: { ...m.source, ...patch } });
  };

  const remove = (i: number) => onChange(metrics.filter((_, j) => j !== i));
  const add = () => onChange([...metrics, { ...NEW_METRIC }]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-th-secondary">
        Define each metric this device sends — its name, unit, and how it arrives. Decoding
        runs only when the network server hasn&apos;t already decoded the uplink. For Unit,
        start typing to pick from common units (°C, m³/h, Ω…) or enter your own.
      </p>

      {metrics.map((m, i) => (
        <div key={i} className="rounded-lg border border-th-default overflow-hidden">
          {/* Row 1 — schema */}
          <div className="flex flex-wrap items-end gap-3 p-3 bg-panel/40">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Name *</label>
              <input
                type="text"
                value={m.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="flow_rate"
                className={`${inputCls} w-full font-mono`}
              />
            </div>
            <div className="w-[120px]">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Type</label>
              <select value={m.type} onChange={(e) => update(i, { type: e.target.value })} className={`${inputCls} w-full`}>
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="w-[90px]">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Unit</label>
              <input
                type="text"
                list="unit-suggestions"
                value={m.unit}
                onChange={(e) => update(i, { unit: e.target.value })}
                placeholder="e.g. °C"
                className={`${inputCls} w-full`}
              />
            </div>
            <label className="flex items-center gap-1.5 pb-2 text-xs text-th-secondary cursor-pointer">
              <input type="checkbox" checked={m.required} onChange={(e) => update(i, { required: e.target.checked })} className="w-4 h-4 rounded" />
              Required
            </label>
            <button type="button" onClick={() => remove(i)} className={`${btn.iconDanger} mb-0.5`} title="Remove metric">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Row 2 — description */}
          <div className="px-3 pb-3">
            <input
              type="text"
              value={m.description}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder="Description (optional)"
              className={`${inputCls} w-full`}
            />
          </div>

          {/* Row 3 — how it arrives */}
          <div className="px-3 pb-3 space-y-3 border-t border-th-subtle pt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-widest text-th-muted mr-1">How it arrives</span>
              <div className="flex gap-1 p-0.5 bg-panel rounded-lg border border-[var(--color-border)]">
                {SOURCE_TABS.map((t) => (
                  <button
                    key={t.mode}
                    type="button"
                    onClick={() => setSource(i, t.mode)}
                    className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 transition-colors ${
                      m.source.mode === t.mode ? 'bg-surface text-primary-600 shadow-sm font-medium' : 'text-th-muted hover:text-th-primary'
                    }`}
                  >
                    {t.icon}{t.label}
                  </button>
                ))}
              </div>
            </div>

            {m.source.mode === 'direct' && (
              <p className="text-xs text-th-muted">The device (or its network server) already sends this exact key. Nothing to configure.</p>
            )}

            {m.source.mode === 'rename' && (
              <div className="w-64">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Raw key the device sends</label>
                <input
                  type="text"
                  value={m.source.rawKey}
                  onChange={(e) => update(i, { source: { mode: 'rename', rawKey: e.target.value } })}
                  placeholder="WATER_FLOW_BOILER"
                  className={`${inputCls} w-full font-mono`}
                />
                <p className="text-xs text-th-muted mt-1">Renamed to <span className="font-mono">{m.name || 'this metric'}</span>.</p>
              </div>
            )}

            {m.source.mode === 'decode' && (
              <div className="flex flex-wrap gap-3 items-end">
                <Field label="Byte type">
                  <select
                    value={m.source.byteType}
                    onChange={(e) => {
                      const bt = e.target.value as DecoderField['type'];
                      updateDecode(i, { byteType: bt, length: BYTE_LEN[bt] });
                    }}
                    className={`${inputCls} w-[130px]`}
                  >
                    {DECODER_FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Offset"><input type="number" value={m.source.offset} onChange={(e) => updateDecode(i, { offset: Number(e.target.value) })} className={`${inputCls} w-[72px]`} /></Field>
                <Field label="Length"><input type="number" value={m.source.length} onChange={(e) => updateDecode(i, { length: Number(e.target.value) })} className={`${inputCls} w-[72px]`} /></Field>
                <Field label="Endian">
                  <select value={m.source.endian} onChange={(e) => updateDecode(i, { endian: e.target.value as 'big' | 'little' })} className={`${inputCls} w-[90px]`}>
                    <option value="big">big</option>
                    <option value="little">little</option>
                  </select>
                  {m.source.byteType === 'bcd' && (
                    <p className="text-[10px] text-th-muted mt-1 w-[90px]">little = last byte most significant</p>
                  )}
                </Field>
                {m.source.byteType !== 'bcd' && m.source.byteType !== 'float32' && (
                  <Field label="Bit (optional)">
                    <input
                      type="number" min={0} max={7}
                      value={m.source.bit ?? ''}
                      onChange={(e) => updateDecode(i, { bit: e.target.value === '' ? undefined : Number(e.target.value) })}
                      placeholder="whole field"
                      className={`${inputCls} w-[90px]`}
                    />
                  </Field>
                )}
                <Field label="Scale"><input type="number" step="any" value={m.source.scale} onChange={(e) => updateDecode(i, { scale: Number(e.target.value) })} className={`${inputCls} w-[80px]`} /></Field>
                <Field label="± Offset"><input type="number" step="any" value={m.source.value_offset} onChange={(e) => updateDecode(i, { value_offset: Number(e.target.value) })} className={`${inputCls} w-[80px]`} /></Field>
              </div>
            )}
            {m.source.mode === 'decode' && m.source.bit != null && (
              <p className="text-xs text-th-muted mt-2">
                Reads only bit {m.source.bit} of this byte as 0/1 — for pulling one flag out of a packed status byte
                (e.g. bit 3 of an alarms byte). Leave blank to use the whole field&apos;s numeric value instead.
              </p>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="w-full py-2.5 border-2 border-dashed border-[var(--color-input-border)] rounded-lg text-th-secondary hover:text-primary-600 hover:border-primary-400 transition-colors flex items-center justify-center gap-2 text-sm"
      >
        <Plus className="w-4 h-4" />
        Add Metric
      </button>

      {anyDecode && (
        <div className="flex items-center gap-3 rounded-lg bg-panel/40 border border-th-default p-3">
          <div className="w-40">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Decode only on FPort</label>
            <input
              type="number"
              value={fPort ?? ''}
              onChange={(e) => onFPortChange(e.target.value ? Number(e.target.value) : null)}
              placeholder="any port"
              className={`${inputCls} w-full`}
            />
          </div>
          <p className="text-xs text-th-muted flex-1">
            Optional — restrict byte-decoding to this LoRaWAN FPort. Value = raw × scale + offset
            (e.g. a uint16 of <span className="font-mono">425</span> × <span className="font-mono">0.1</span> = <span className="font-mono">42.5</span>).
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">{label}</label>
      {children}
    </div>
  );
}
