/**
 * Resolve a human-readable display label for a metric key.
 *
 * Priority:
 * 1. schema[key].description  (from device type data_model)
 * 2. Title Case formatting:   temperature_c → "Temperature C"
 */
export function formatMetricLabel(
  key: string,
  schema?: Record<string, { description?: string; [k: string]: unknown }>
): string {
  if (schema?.[key]?.description) return schema[key].description as string;
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
