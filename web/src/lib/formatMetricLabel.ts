/** Descriptions longer than this read as an explanatory sentence, not a title — e.g. an
 *  alarm's trigger condition ("Continuous minimum flow detected for 12+ consecutive hours…").
 *  Past this length, fall back to the title-cased key instead of shouting a sentence as a label. */
const MAX_LABEL_LENGTH = 40;

/**
 * Resolve a human-readable display label for a metric key.
 *
 * Priority:
 * 1. schema[key].description, if short enough to be a label (from device type data_model)
 * 2. Title Case formatting:   temperature_c → "Temperature C"
 */
export function formatMetricLabel(
  key: string,
  schema?: Record<string, { description?: string }>
): string {
  const description = schema?.[key]?.description;
  if (description && description.length <= MAX_LABEL_LENGTH) return description;
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
