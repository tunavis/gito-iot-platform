'use client';

import React from 'react';
import { Plus, Trash2, Terminal } from 'lucide-react';
import { btn } from '@/components/ui/buttonStyles';
import type { CommandDef, CommandParameter } from '../../_types';

/**
 * Card-per-command editor for command_schema. Each command has a name,
 * description, and a list of parameters (name/type/unit/range/required) that
 * drives the real form the "Send Command" UI on the device page renders —
 * this is the only place that data can be authored; without it, devices with
 * the "commands" capability fall back to a free-text command-name guess.
 */

interface CommandsTableProps {
  commands: CommandDef[];
  onChange: (commands: CommandDef[]) => void;
}

const PARAM_TYPES: CommandParameter['type'][] = ['float', 'integer', 'string', 'boolean'];

const NEW_COMMAND: CommandDef = { name: '', description: '', parameters: [] };
const NEW_PARAMETER: CommandParameter = { name: '', type: 'string', required: false };

const inputCls =
  'px-2.5 py-1.5 border border-[var(--color-input-border)] rounded-md text-sm bg-[var(--color-input-bg)] text-th-primary focus:outline-none focus:ring-1 focus:ring-primary-500';

export default function CommandsTable({ commands, onChange }: CommandsTableProps) {
  const updateCommand = (i: number, patch: Partial<CommandDef>) => {
    const next = [...commands];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const removeCommand = (i: number) => onChange(commands.filter((_, j) => j !== i));
  const addCommand = () => onChange([...commands, { ...NEW_COMMAND }]);

  const updateParam = (ci: number, pi: number, patch: Partial<CommandParameter>) => {
    const params = [...commands[ci].parameters];
    params[pi] = { ...params[pi], ...patch };
    updateCommand(ci, { parameters: params });
  };
  const removeParam = (ci: number, pi: number) =>
    updateCommand(ci, { parameters: commands[ci].parameters.filter((_, j) => j !== pi) });
  const addParam = (ci: number) =>
    updateCommand(ci, { parameters: [...commands[ci].parameters, { ...NEW_PARAMETER }] });

  return (
    <div className="space-y-4">
      <p className="text-sm text-th-secondary">
        Define each remote command this device type accepts. A command with no parameters shows
        as a one-click Quick Action; one with parameters renders a validated form — without an
        entry here, the device page falls back to a free-text command name with no guidance.
      </p>

      {commands.map((cmd, ci) => (
        <div key={ci} className="rounded-lg border border-th-default overflow-hidden">
          <div className="flex flex-wrap items-start gap-3 p-3 bg-panel/40">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">
                Command name
              </label>
              <input
                value={cmd.name}
                onChange={(e) => updateCommand(ci, { name: e.target.value })}
                placeholder="e.g. reboot"
                className={`${inputCls} w-full font-mono`}
              />
            </div>
            <div className="flex-[2] min-w-[220px]">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">
                Description
              </label>
              <input
                value={cmd.description}
                onChange={(e) => updateCommand(ci, { description: e.target.value })}
                placeholder="What this command does"
                className={`${inputCls} w-full`}
              />
            </div>
            <button
              type="button"
              onClick={() => removeCommand(ci)}
              className={`${btn.iconDanger} mt-4`}
              title="Remove command"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 space-y-2">
            {cmd.parameters.length === 0 && (
              <p className="text-xs text-th-muted italic">
                No parameters — this command will show as a one-click Quick Action.
              </p>
            )}
            {cmd.parameters.map((p, pi) => (
              <div key={pi} className="flex flex-wrap items-end gap-2 p-2 rounded-md bg-page/60">
                <div className="w-[130px]">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Name</label>
                  <input
                    value={p.name}
                    onChange={(e) => updateParam(ci, pi, { name: e.target.value })}
                    placeholder="e.g. seconds"
                    className={`${inputCls} w-full font-mono`}
                  />
                </div>
                <div className="w-[110px]">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Type</label>
                  <select
                    value={p.type}
                    onChange={(e) => updateParam(ci, pi, { type: e.target.value as CommandParameter['type'] })}
                    className={`${inputCls} w-full`}
                  >
                    {PARAM_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
                {p.type === 'string' ? (
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">
                      Allowed values (comma-separated, optional)
                    </label>
                    <input
                      value={(p.enum || []).join(', ')}
                      onChange={(e) =>
                        updateParam(ci, pi, {
                          enum: e.target.value.trim() ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
                        })
                      }
                      placeholder="e.g. low, medium, high"
                      className={`${inputCls} w-full`}
                    />
                  </div>
                ) : (
                  <>
                    <div className="w-[80px]">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Min</label>
                      <input
                        type="number"
                        value={p.min ?? ''}
                        onChange={(e) => updateParam(ci, pi, { min: e.target.value === '' ? undefined : Number(e.target.value) })}
                        className={`${inputCls} w-full`}
                      />
                    </div>
                    <div className="w-[80px]">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Max</label>
                      <input
                        type="number"
                        value={p.max ?? ''}
                        onChange={(e) => updateParam(ci, pi, { max: e.target.value === '' ? undefined : Number(e.target.value) })}
                        className={`${inputCls} w-full`}
                      />
                    </div>
                    <div className="w-[80px]">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Unit</label>
                      <input
                        list="unit-suggestions"
                        value={p.unit || ''}
                        onChange={(e) => updateParam(ci, pi, { unit: e.target.value || undefined })}
                        placeholder="e.g. s"
                        className={`${inputCls} w-full`}
                      />
                    </div>
                  </>
                )}
                <label className="flex items-center gap-1.5 pb-1.5 text-xs text-th-secondary whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={!!p.required}
                    onChange={(e) => updateParam(ci, pi, { required: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-[var(--color-input-border)] text-primary-600 focus:ring-primary-500"
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() => removeParam(ci, pi)}
                  className={`${btn.iconDanger} mb-0.5`}
                  title="Remove parameter"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addParam(ci)}
              className="w-full py-2 border border-dashed border-[var(--color-input-border)] rounded-md text-th-secondary hover:text-primary-600 hover:border-primary-400 transition-colors flex items-center justify-center gap-1.5 text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Parameter
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addCommand}
        className="w-full py-2.5 border-2 border-dashed border-[var(--color-input-border)] rounded-lg text-th-secondary hover:text-primary-600 hover:border-primary-400 transition-colors flex items-center justify-center gap-2 text-sm"
      >
        <Terminal className="w-4 h-4" />
        Add Command
      </button>
    </div>
  );
}
