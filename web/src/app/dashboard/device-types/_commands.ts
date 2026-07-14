/**
 * Merge/split contract between the Commands editor and the stored
 * command_schema column: a dict keyed by command name. The form wants name as
 * a regular editable field, not a dict key, so this is the one translation
 * layer between them.
 *
 * merge: Record<name, CommandSchemaEntry> -> CommandDef[]
 * split: CommandDef[] -> Record<name, CommandSchemaEntry>
 */

import type { CommandDef, CommandSchemaEntry } from './_types';

export function mergeCommands(
  command_schema: Record<string, CommandSchemaEntry> | null | undefined,
): CommandDef[] {
  if (!command_schema) return [];
  return Object.entries(command_schema).map(([name, entry]) => ({
    name,
    description: entry.description || '',
    parameters: entry.parameters || [],
  }));
}

export function splitCommands(commands: CommandDef[]): Record<string, CommandSchemaEntry> {
  const command_schema: Record<string, CommandSchemaEntry> = {};
  for (const cmd of commands) {
    if (!cmd.name.trim()) continue; // unnamed rows don't round-trip - drop, don't crash
    command_schema[cmd.name.trim()] = {
      description: cmd.description || '',
      parameters: cmd.parameters,
    };
  }
  return command_schema;
}

// ── round-trip self-check (runs only under Node; harmless in the browser bundle
//    where require is absent) ──
declare const require: any;
// eslint-disable-next-line @next/next/no-assign-module-variable -- declare, not assign; Node-only self-check guard
declare const module: any;
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const assert = require('assert');
  const schema: Record<string, CommandSchemaEntry> = {
    reboot: { description: 'Restart the device', parameters: [] },
    set_interval: {
      description: 'Change telemetry interval',
      parameters: [
        { name: 'seconds', type: 'integer', min: 10, max: 3600, required: true, unit: 's' },
      ],
    },
  };

  const merged = mergeCommands(schema);
  assert.strictEqual(merged.length, 2, 'two commands');
  assert.strictEqual(merged.find((c) => c.name === 'set_interval')!.parameters.length, 1);

  const split = splitCommands(merged);
  assert.deepStrictEqual(split, schema, 'round-trips exactly');

  assert.deepStrictEqual(mergeCommands(null), [], 'null schema -> empty array');
  assert.deepStrictEqual(mergeCommands(undefined), [], 'undefined schema -> empty array');
  assert.deepStrictEqual(splitCommands([{ name: '  ', description: '', parameters: [] }]), {}, 'unnamed rows dropped');

  console.log('command round-trip self-check passed');
}
