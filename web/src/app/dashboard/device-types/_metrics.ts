/**
 * Merge/split contract between the unified Metrics editor and the three stored
 * columns (data_model, decoder, key_mapping). The backend keeps all three; this
 * module is the single translation layer so they can never drift apart.
 *
 * merge:  (data_model, decoder, key_mapping) -> UnifiedMetric[]
 * split:  UnifiedMetric[] -> { data_model, decoder, key_mapping }
 *
 * Round-trip invariant: split(merge(x)) reproduces x's three columns (order and
 * defaults normalized). A tiny self-check runs at the bottom under Node.
 */

import type {
  DataModelField,
  PayloadDecoder,
  UnifiedMetric,
  MetricSource,
} from './_types';

interface SplitResult {
  data_model: DataModelField[];
  decoder: PayloadDecoder | null;
  key_mapping: Record<string, string>;
}

/** Build one unified list from the three stored columns, joined by canonical name. */
export function mergeMetrics(
  data_model: DataModelField[] = [],
  decoder: PayloadDecoder | null | undefined,
  key_mapping: Record<string, string> = {},
): UnifiedMetric[] {
  const byName = new Map<string, UnifiedMetric>();

  // 1. Seed from the schema (data_model) — the source of unit/type/description.
  //    The API serialises min/max under their aliases ("min"/"max"); accept both
  //    so ranges survive the load → edit → save round-trip.
  for (const f of data_model) {
    byName.set(f.name, {
      name: f.name,
      type: f.type || 'float',
      unit: f.unit || '',
      description: f.description || '',
      min_value: (f as any).min ?? f.min_value,
      max_value: (f as any).max ?? f.max_value,
      required: !!f.required,
      source: { mode: 'direct' },
    });
  }

  const ensure = (name: string): UnifiedMetric => {
    let m = byName.get(name);
    if (!m) {
      m = { name, type: 'float', unit: '', description: '', required: false, source: { mode: 'direct' } };
      byName.set(name, m);
    }
    return m;
  };

  // 2. Attach decoder byte-layout — a decoded field's canonical name is its metric.
  for (const df of decoder?.fields ?? []) {
    const m = ensure(df.name);
    m.source = {
      mode: 'decode',
      offset: df.offset,
      length: df.length,
      byteType: df.type,
      endian: df.endian ?? 'big',
      scale: df.scale ?? 1,
      value_offset: df.value_offset ?? 0,
      ...(df.bit != null ? { bit: df.bit } : {}),
    };
  }

  // 3. Attach renames — key_mapping is {rawKey: canonicalName}. A metric already
  //    decoded from bytes keeps that source (decode wins over rename).
  for (const [rawKey, canonical] of Object.entries(key_mapping)) {
    const m = ensure(canonical);
    if (m.source.mode !== 'decode') {
      m.source = { mode: 'rename', rawKey };
    }
  }

  return Array.from(byName.values());
}

/** Split the unified list back into the three stored columns for the PUT. */
export function splitMetrics(
  metrics: UnifiedMetric[],
  fPort?: number,
): SplitResult {
  const data_model: DataModelField[] = metrics.map((m) => ({
    name: m.name,
    type: m.type || 'float',
    unit: m.unit || '',
    description: m.description || '',
    min_value: m.min_value,
    max_value: m.max_value,
    required: !!m.required,
  }));

  const decoderFields = metrics
    .filter((m): m is UnifiedMetric & { source: Extract<MetricSource, { mode: 'decode' }> } =>
      m.source.mode === 'decode')
    .map((m) => ({
      name: m.name,
      offset: m.source.offset,
      length: m.source.length,
      type: m.source.byteType,
      endian: m.source.endian,
      scale: m.source.scale,
      value_offset: m.source.value_offset,
      ...(m.source.bit != null ? { bit: m.source.bit } : {}),
    }));

  const decoder: PayloadDecoder | null = decoderFields.length
    ? { type: 'declarative', ...(fPort != null ? { f_port: fPort } : {}), fields: decoderFields }
    : null;

  const key_mapping: Record<string, string> = {};
  for (const m of metrics) {
    if (m.source.mode === 'rename' && m.source.rawKey) {
      key_mapping[m.source.rawKey] = m.name;
    }
  }

  return { data_model, decoder, key_mapping };
}

// ── round-trip self-check (runs only under Node: `node --loader ... _metrics.ts`
//    or via the ts test; harmless in the browser bundle where require is absent) ──
declare const require: any;
// eslint-disable-next-line @next/next/no-assign-module-variable -- declare, not assign; Node-only self-check guard
declare const module: any;
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const assert = require('assert');
  const dm: DataModelField[] = [
    { name: 'flow_rate', type: 'float', unit: 'm³/h', description: 'Flow', min_value: 0, max_value: 100, required: true },
    { name: 'status', type: 'boolean', unit: '', description: '', required: false },
    { name: 'temperature', type: 'float', unit: '°C', description: 'Temp', required: false },
  ];
  const decoder: PayloadDecoder = {
    type: 'declarative', f_port: 2,
    fields: [{ name: 'flow_rate', offset: 0, length: 2, type: 'uint16', endian: 'big', scale: 0.1, value_offset: 0, bit: 3 }],
  };
  const key_mapping = { RAW_TEMP: 'temperature' };

  const merged = mergeMetrics(dm, decoder, key_mapping);
  assert.strictEqual(merged.length, 3, 'three unified metrics');
  assert.strictEqual(merged.find((m) => m.name === 'flow_rate')!.source.mode, 'decode');
  assert.strictEqual(merged.find((m) => m.name === 'temperature')!.source.mode, 'rename');
  assert.strictEqual(merged.find((m) => m.name === 'status')!.source.mode, 'direct');

  const split = splitMetrics(merged, 2);
  assert.deepStrictEqual(split.key_mapping, key_mapping, 'key_mapping round-trips');
  assert.strictEqual(split.decoder!.fields.length, 1, 'one decoder field');
  assert.strictEqual(split.decoder!.f_port, 2, 'f_port preserved');
  assert.strictEqual(split.data_model.length, 3, 'all three in schema');
  assert.strictEqual(split.data_model.find((f) => f.name === 'flow_rate')!.unit, 'm³/h', 'schema meta preserved');
  assert.strictEqual(split.decoder!.fields[0].bit, 3, 'bit round-trips');
  assert.strictEqual(
    splitMetrics(mergeMetrics(dm, { type: 'declarative', fields: [{ name: 'flow_rate', offset: 0, length: 2, type: 'uint16' }] }, {})).decoder!.fields[0].bit,
    undefined,
    'bit stays absent when not set',
  );

  // empty decoder -> null
  assert.strictEqual(splitMetrics(mergeMetrics(dm, null, {})).decoder, null, 'no decode fields -> null decoder');
  console.log('round-trip self-check passed');
}
