'use client';

import { useState } from 'react';
import { input, btn } from '@/components/ui/buttonStyles';
import { formatMetricLabel } from '@/lib/formatMetricLabel';
import type { Schema } from '@/lib/deviceSchema';
import { operatorToApi, type AlertCondition } from '../ruleGraph';

/**
 * The in-place condition editor: a popover anchored to the node it edits.
 *
 * Not a modal (it would cover the graph being edited) and not a side panel (it
 * would fight the rule picker). A React Flow node is plain DOM, so this is just
 * positioned markup inside the node — no new dependency, no viewport maths.
 *
 * Saving is an explicit action. Auto-saving on blur would issue a PUT per
 * keystroke and make a mis-typed threshold a persisted value.
 */

const OPERATORS: Array<{ value: string; label: string }> = [
  { value: 'gt', label: '> greater than' },
  { value: 'gte', label: '≥ at least' },
  { value: 'lt', label: '< less than' },
  { value: 'lte', label: '≤ at most' },
  { value: 'eq', label: '= equals' },
  { value: 'neq', label: '≠ not equal' },
];

export interface ConditionEditorProps {
  condition: AlertCondition;
  /** Metric keys from the device type's telemetry schema. */
  metrics: string[];
  schema: Schema;
  /** COMPOSITE conditions carry a weight; a THRESHOLD rule has no such column. */
  showWeight: boolean;
  busy: boolean;
  onSave: (condition: AlertCondition) => void;
  onCancel: () => void;
}

export default function ConditionEditor({
  condition,
  metrics,
  schema,
  showWeight,
  busy,
  onSave,
  onCancel,
}: ConditionEditorProps) {
  const [field, setField] = useState(condition.field);
  const [operator, setOperator] = useState(operatorToApi(condition.operator));
  const [threshold, setThreshold] = useState(String(condition.threshold ?? 0));
  const [weight, setWeight] = useState(String(condition.weight || 1));

  // A rule may reference a metric the device type no longer declares. Keep it in
  // the list rather than silently rewriting the rule to the first schema field.
  const options = metrics.includes(field) || !field ? metrics : [field, ...metrics];
  const unit = schema[field]?.unit;
  const range = schema[field];

  const save = () => {
    const value = Number(threshold);
    if (!field || Number.isNaN(value)) return;
    onSave({ field, operator, threshold: value, weight: Number(weight) || 1 });
  };

  return (
    // nodrag/nopan: without them React Flow swallows the drag-to-select-text and
    // pans the canvas instead.
    <div
      className="nodrag nopan absolute left-0 top-full mt-2 z-50 rounded-lg p-3 space-y-2 cursor-default"
      style={{
        width: 260,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-primary)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div>
        <label className="block text-[10px] uppercase tracking-wider mb-1 text-th-muted">Metric</label>
        {options.length > 0 ? (
          <select value={field} onChange={(e) => setField(e.target.value)} className={input.select}>
            {options.map((m) => (
              <option key={m} value={m}>
                {formatMetricLabel(m, schema)}
                {schema[m]?.unit ? ` (${schema[m].unit})` : ''}
              </option>
            ))}
          </select>
        ) : (
          // No device type schema (or a global rule with none): free text beats
          // an empty dropdown the user cannot get past.
          <input value={field} onChange={(e) => setField(e.target.value)} className={input.base} />
        )}
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-[10px] uppercase tracking-wider mb-1 text-th-muted">Operator</label>
          <select value={operator} onChange={(e) => setOperator(e.target.value)} className={input.select}>
            {OPERATORS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div style={{ width: 88 }}>
          <label className="block text-[10px] uppercase tracking-wider mb-1 text-th-muted">
            Value{unit ? ` (${unit})` : ''}
          </label>
          <input
            type="number"
            step="any"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className={input.base}
          />
        </div>
      </div>

      {/* `!= null`, not `!== undefined`: a device type's data_model stores an
          unbounded field as min/max **null**, which would otherwise render an
          empty "Schema range: –". */}
      {range?.min != null && range?.max != null && (
        <p className="text-[10px] text-th-muted">
          Schema range: {range.min} – {range.max}
        </p>
      )}

      {showWeight && (
        <div style={{ width: 88 }}>
          <label className="block text-[10px] uppercase tracking-wider mb-1 text-th-muted">Weight</label>
          <input
            type="number"
            min={1}
            max={100}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className={input.base}
          />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={`${btn.primary} flex-1 disabled:opacity-60`}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={`${btn.secondary} flex-1 disabled:opacity-60`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
