'use client';

import React from 'react';
import { Plus, Trash2, CheckCircle2, Minus } from 'lucide-react';
import { btn } from '@/components/ui/buttonStyles';
import { FIELD_TYPES, fieldTypeBadgeStyles, formatRange } from '../../_constants';
import type { DataModelField } from '../../_types';

interface DataModelTableProps {
  fields: DataModelField[];
  mode: 'view' | 'edit';
  onUpdate?: (index: number, updates: Partial<DataModelField>) => void;
  onRemove?: (index: number) => void;
  onAdd?: () => void;
}

export default function DataModelTable({ fields, mode, onUpdate, onRemove, onAdd }: DataModelTableProps) {
  if (mode === 'view') {
    if (fields.length === 0) {
      return (
        <div className="py-8 text-center">
          <p className="text-sm text-th-muted">No telemetry fields defined yet.</p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-panel border-b border-th-default">
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted">Name</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted">Type</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted">Unit</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted">Range</th>
              <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-th-muted">Required</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted">Description</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, i) => {
              const typeStyle = fieldTypeBadgeStyles[field.type] || fieldTypeBadgeStyles.string;
              return (
                <tr key={i} className="border-b border-th-subtle hover:bg-page transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm font-medium text-th-primary">{field.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="px-2 py-0.5 rounded text-xs font-semibold"
                      style={{ background: typeStyle.bg, color: typeStyle.color, border: `1px solid ${typeStyle.border}` }}
                    >
                      {field.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-th-secondary">{field.unit || '—'}</td>
                  <td className="px-4 py-3 text-sm text-th-secondary font-mono">
                    {formatRange(field.min_value, field.max_value)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {field.required ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 inline-block" />
                    ) : (
                      <Minus className="w-3.5 h-3.5 text-th-muted inline-block" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-th-secondary">{field.description || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Edit mode — inline editable table
  return (
    <div className="space-y-3">
      {fields.length > 0 && (
        <div className="overflow-x-auto border border-th-default rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="bg-panel border-b border-th-default">
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted">Name *</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted w-[110px]">Type</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted w-[80px]">Unit</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted w-[80px]">Min</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted w-[80px]">Max</th>
                <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-widest text-th-muted w-[50px]">Req</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-th-muted">Description</th>
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
                      onChange={(e) => onUpdate?.(index, { name: e.target.value })}
                      placeholder="temperature"
                      className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm font-mono bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={field.type}
                      onChange={(e) => onUpdate?.(index, { type: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={field.unit}
                      onChange={(e) => onUpdate?.(index, { unit: e.target.value })}
                      placeholder="°C"
                      className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={field.min_value ?? ''}
                      onChange={(e) => onUpdate?.(index, { min_value: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="—"
                      className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={field.max_value ?? ''}
                      onChange={(e) => onUpdate?.(index, { max_value: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="—"
                      className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => onUpdate?.(index, { required: e.target.checked })}
                      className="w-4 h-4 rounded border-[var(--color-input-border)] text-primary-600 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={field.description}
                      onChange={(e) => onUpdate?.(index, { description: e.target.value })}
                      placeholder="Ambient temperature"
                      className="w-full px-2 py-1.5 border border-[var(--color-input-border)] rounded text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onRemove?.(index)}
                      className={btn.iconDanger}
                    >
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
        onClick={onAdd}
        className="w-full py-2.5 border-2 border-dashed border-[var(--color-input-border)] rounded-lg text-th-secondary hover:text-primary-600 hover:border-primary-400 transition-colors flex items-center justify-center gap-2 text-sm"
      >
        <Plus className="w-4 h-4" />
        Add Field
      </button>
    </div>
  );
}
