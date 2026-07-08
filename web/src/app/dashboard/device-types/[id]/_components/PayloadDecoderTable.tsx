'use client';

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { btn, input } from '@/components/ui/buttonStyles';
import { DECODER_FIELD_TYPES } from '../../_constants';
import type { PayloadDecoder, DecoderField } from '../../_types';

interface PayloadDecoderTableProps {
  decoder: PayloadDecoder | null;
  onChange: (decoder: PayloadDecoder | null) => void;
}

const EMPTY_FIELD: DecoderField = {
  name: '', offset: 0, length: 1, type: 'uint16', endian: 'big', scale: 1, value_offset: 0,
};

export default function PayloadDecoderTable({ decoder, onChange }: PayloadDecoderTableProps) {
  const enabled = decoder !== null;
  const fields = decoder?.fields ?? [];

  const toggleEnabled = (on: boolean) => {
    onChange(on ? { type: 'declarative', fields: [] } : null);
  };

  const updateField = (index: number, updates: Partial<DecoderField>) => {
    if (!decoder) return;
    const next = [...fields];
    next[index] = { ...next[index], ...updates };
    onChange({ ...decoder, fields: next });
  };

  const removeField = (index: number) => {
    if (!decoder) return;
    onChange({ ...decoder, fields: fields.filter((_, i) => i !== index) });
  };

  const addField = () => {
    if (!decoder) return;
    onChange({ ...decoder, fields: [...fields, { ...EMPTY_FIELD }] });
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggleEnabled(e.target.checked)}
          className="w-4 h-4 rounded border-[var(--color-input-border)] text-primary-600 focus:ring-primary-500"
        />
        <span className="text-sm font-medium text-th-primary">
          Decode this device&apos;s payload ourselves
        </span>
      </label>
      <p className="text-xs text-th-muted pl-7">
        Used only when the network server (e.g. ChirpStack) hasn&apos;t already decoded the
        uplink. Define the byte layout below — offsets and lengths in bytes, big-endian
        unless the device says otherwise.
      </p>

      {enabled && (
        <div className="pl-7 space-y-3">
          <div className="w-40">
            <label className="block text-xs font-medium text-th-primary mb-1">
              FPort filter (optional)
            </label>
            <input
              type="number"
              value={decoder?.f_port ?? ''}
              onChange={(e) =>
                onChange({
                  ...decoder!,
                  f_port: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="any"
              className={input.base}
            />
          </div>

          {fields.length > 0 && (
            <div className="overflow-x-auto border border-th-default rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="bg-panel border-b border-th-default">
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted">Name *</th>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted w-[80px]">Offset</th>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted w-[80px]">Length</th>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted w-[140px]">Type</th>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted w-[90px]">Endian</th>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted w-[80px]">Scale</th>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted w-[90px]">+/- Offset</th>
                    <th className="px-3 py-2 w-[40px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => (
                    <tr key={index} className="border-b border-th-subtle last:border-b-0">
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={field.name}
                          onChange={(e) => updateField(index, { name: e.target.value })}
                          placeholder="flow_rate"
                          className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm font-mono bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={field.offset}
                          onChange={(e) => updateField(index, { offset: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={field.length}
                          onChange={(e) => updateField(index, { length: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={field.type}
                          onChange={(e) => {
                            const type = e.target.value as DecoderField['type'];
                            const byteLen = { uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, float32: 4 }[type];
                            updateField(index, { type, length: byteLen });
                          }}
                          className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                          {DECODER_FIELD_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={field.endian ?? 'big'}
                          onChange={(e) => updateField(index, { endian: e.target.value as 'big' | 'little' })}
                          className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                          <option value="big">big</option>
                          <option value="little">little</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="any"
                          value={field.scale ?? 1}
                          onChange={(e) => updateField(index, { scale: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="any"
                          value={field.value_offset ?? 0}
                          onChange={(e) => updateField(index, { value_offset: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => removeField(index)} className={btn.iconDanger}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            onClick={addField}
            className="w-full py-2.5 border-2 border-dashed border-[var(--color-input-border)] rounded-lg text-th-secondary hover:text-primary-600 hover:border-primary-400 transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Byte Field
          </button>

          <p className="text-xs text-th-muted">
            Value = raw × scale + offset. E.g. a uint16 of <code>425</code> with scale{' '}
            <code>0.1</code> decodes to <code>42.5</code>.
          </p>
        </div>
      )}
    </div>
  );
}
