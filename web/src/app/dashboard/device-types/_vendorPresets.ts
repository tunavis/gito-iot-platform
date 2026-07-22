import type { DataModelField, DecoderField } from './_types';

/**
 * Known-vendor payload presets — prefills the metric schema + byte-decoder
 * fields for a specific real device so nobody has to hand-derive byte offsets
 * from a datasheet. Picking one populates the Metrics editor exactly as if
 * you'd typed it in yourself; nothing here is applied silently.
 */
export interface VendorPreset {
  id: string;
  vendor: string;
  model: string;
  category: string;
  protocol: 'lorawan' | 'mqtt' | 'http';
  color: string;
  icon: string;
  /** Shown on the picker and pre-filled into the device type's own description. */
  description: string;
  dataModel: DataModelField[];
  decoderFields: DecoderField[];
}

export const VENDOR_PRESETS: VendorPreset[] = [
  {
    id: 'bmeters-iwm-lr3-lr4',
    vendor: 'B METERS',
    model: 'IWM-LR3 / IWM-LR4',
    category: 'meter',
    protocol: 'lorawan',
    color: '#3b82f6',
    icon: 'droplets',
    description:
      "Decodes the standard 13-byte IWM-LR3/LR4 uplink payload (application code 0x44) from the vendor's " +
      "v1.0 user manual. total_volume is always reported in litres — the manual's overflow rule (counter " +
      "keeps counting instead of resetting, VIF steps litres → decalitres → hectolitres → m³) is applied " +
      "automatically from the same uplink's vif_code, so it stays correct across an overflow with no per-" +
      "device K-factor setup. reverse_volume is always plain litres per the manual (never VIF-scaled). The " +
      "optional 2-byte temperature extension (enabled via a SET_ALARM_PAR downlink) is not decoded — B METERS " +
      "encodes it as sign-magnitude (a separate sign bit + 15-bit magnitude), which this platform's byte " +
      "decoder doesn't support.",
    dataModel: [
      {
        name: 'total_volume', type: 'float', unit: 'L', required: true,
        description: "Net cumulative flow, |forward − reverse|, in litres — auto-corrected for the meter's VIF-driven counter overflow.",
        simulation: { mode: 'increment', min: 5000, max: 200000 },
      },
      {
        name: 'reverse_volume', type: 'float', unit: 'L', required: false,
        description: 'Cumulative reverse (backward) flow.',
        simulation: { mode: 'drift', min: 0, max: 200 },
      },
      {
        name: 'k_index', type: 'integer', unit: '', required: false,
        description: 'Meter multiplier: 0 = ×1 (litres), 1 = ×10 (decalitres), 2 = ×100 (hectolitres). Fixed per physical meter model.',
        // Device configuration, not a live reading — pinned, not drifted.
        simulation: { mode: 'drift', min: 0, max: 0 },
      },
      {
        name: 'medium_code', type: 'integer', unit: '', required: false,
        description: 'Which medium the meter is configured for: 0 = water, 1 = hot water. Set via SET_METER_PAR, fixed per installation.',
        simulation: { mode: 'drift', min: 0, max: 0 },
      },
      {
        name: 'vif_code', type: 'integer', unit: '', required: false,
        description: 'Counter unit in use: 0x13 litres, 0x14 decalitres, 0x15 hectolitres, 0x16 m³. Only changes if the counter overflows.',
        // Pinned at the base unit (19 = litres): a random vif_code would make
        // total_volume's VIF-exponent scaling (see decoderFields below)
        // produce absurd values — overflow is the rare real-world case, not
        // the default one, so simulation shouldn't manufacture it.
        simulation: { mode: 'drift', min: 19, max: 19 },
      },
      { name: 'magnetic_alarm', type: 'boolean', unit: '', required: false, description: 'Magnetic tampering field detected for 10+ minutes.', simulation: { mode: 'rare_bit' } },
      { name: 'removal_alarm', type: 'boolean', unit: '', required: false, description: 'Module physically removed from the meter.', simulation: { mode: 'rare_bit' } },
      { name: 'sensor_fraud_alarm', type: 'boolean', unit: '', required: false, description: 'Coil sequence indicates the index is being interfered with.', simulation: { mode: 'rare_bit' } },
      { name: 'leakage_alarm', type: 'boolean', unit: '', required: false, description: 'Continuous minimum flow detected for 12+ consecutive hours — possible leak.', simulation: { mode: 'rare_bit' } },
      { name: 'reverse_flow_alarm', type: 'boolean', unit: '', required: false, description: 'More than 20 litres of reverse flow detected.', simulation: { mode: 'rare_bit' } },
      { name: 'low_battery_alarm', type: 'boolean', unit: '', required: false, description: 'Battery voltage below threshold for 5 consecutive readings.', simulation: { mode: 'rare_bit' } },
    ],
    decoderFields: [
      {
        name: 'total_volume', offset: 1, length: 4, type: 'bcd', endian: 'little',
        scale_exponent_ref: 'vif_code', scale_exponent_base: 19,
      },
      { name: 'reverse_volume', offset: 5, length: 4, type: 'bcd', endian: 'little' },
      { name: 'k_index', offset: 9, length: 1, type: 'uint8' },
      { name: 'medium_code', offset: 10, length: 1, type: 'uint8' },
      { name: 'vif_code', offset: 11, length: 1, type: 'uint8' },
      { name: 'magnetic_alarm', offset: 12, length: 1, type: 'uint8', bit: 0 },
      { name: 'removal_alarm', offset: 12, length: 1, type: 'uint8', bit: 1 },
      { name: 'sensor_fraud_alarm', offset: 12, length: 1, type: 'uint8', bit: 2 },
      { name: 'leakage_alarm', offset: 12, length: 1, type: 'uint8', bit: 3 },
      { name: 'reverse_flow_alarm', offset: 12, length: 1, type: 'uint8', bit: 4 },
      { name: 'low_battery_alarm', offset: 12, length: 1, type: 'uint8', bit: 5 },
    ],
  },
  {
    id: 'bmeters-rfm-lr1',
    vendor: 'B METERS',
    model: 'RFM-LR1',
    category: 'meter',
    color: '#06b6d4',
    icon: 'droplets',
    protocol: 'lorawan',
    description:
      "Decodes the RFM-LR1 retrofit water-meter module's periodic report from the vendor's v1.1.2 manual. " +
      "The device speaks a command-index protocol ([type][index][data] triplets); its regular uplink leads " +
      "with the Volume field (a uint32 litre counter at offset 2) and appends a 1-byte Status field at offset " +
      "8 only when an alarm is active — so a healthy meter simply omits the alarm flags. This is a fixed-offset " +
      "model of that Volume(+Status) report; other command-response frames on port 1 aren't parsed. Volume is " +
      "read straight in litres (no BCD, no overflow/VIF scaling — unlike the IWM-LR3/LR4 sibling).",
    dataModel: [
      {
        name: 'total_volume', type: 'float', unit: 'L', required: true,
        description: 'Cumulative water volume as read from the meter dial.',
        // A real meter's counter only ever climbs — simulate it starting
        // somewhere in a plausible "already in service" range and ticking up.
        simulation: { mode: 'increment', min: 50000, max: 500000 },
      },
      { name: 'flow_exceeds_q3_alarm', type: 'boolean', unit: '', required: false, description: "Flow above the meter's Q3 rated maximum for 10+ minutes.", simulation: { mode: 'rare_bit' } },
      { name: 'magnetic_fraud_alarm', type: 'boolean', unit: '', required: false, description: 'Magnetic tampering field detected.', simulation: { mode: 'rare_bit' } },
      { name: 'removal_alarm', type: 'boolean', unit: '', required: false, description: 'Module physically removed from the meter.', simulation: { mode: 'rare_bit' } },
      { name: 'leakage_alarm', type: 'boolean', unit: '', required: false, description: 'Continuous flow suggesting a leak in the last 24 hours.', simulation: { mode: 'rare_bit' } },
    ],
    decoderFields: [
      { name: 'total_volume', offset: 2, length: 4, type: 'uint32', endian: 'big' },
      { name: 'flow_exceeds_q3_alarm', offset: 8, length: 1, type: 'uint8', bit: 7 },
      { name: 'magnetic_fraud_alarm', offset: 8, length: 1, type: 'uint8', bit: 5 },
      { name: 'removal_alarm', offset: 8, length: 1, type: 'uint8', bit: 3 },
      { name: 'leakage_alarm', offset: 8, length: 1, type: 'uint8', bit: 0 },
    ],
  },
];
