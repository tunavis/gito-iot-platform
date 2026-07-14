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
    description:
      "Decodes the standard 13-byte IWM-LR3/LR4 uplink payload (application code 0x44) from the vendor's " +
      "v1.0 user manual. Assumes the default K=1 (litres) variant — CPR-M3-I, GMDM-I, GMB-RP-I, GMB-I. " +
      "For a WDE-K50 install (K=10 or K=100), check the k_index field and scale total_volume/reverse_volume " +
      "by 10x or 100x accordingly. The optional 2-byte temperature extension (enabled via a SET_ALARM_PAR " +
      "downlink) is not decoded — B METERS encodes it as sign-magnitude (a separate sign bit + 15-bit " +
      "magnitude), which this platform's byte decoder doesn't support.",
    dataModel: [
      {
        name: 'total_volume', type: 'float', unit: 'L', required: true,
        description: "Net cumulative flow, |forward − reverse|, from the meter's BCD-packed counter.",
      },
      {
        name: 'reverse_volume', type: 'float', unit: 'L', required: false,
        description: 'Cumulative reverse (backward) flow.',
      },
      {
        name: 'k_index', type: 'integer', unit: '', required: false,
        description: 'Meter multiplier: 0 = ×1 (litres), 1 = ×10 (decalitres), 2 = ×100 (hectolitres). Fixed per physical meter model.',
      },
      {
        name: 'medium_code', type: 'integer', unit: '', required: false,
        description: '0 = water, 1 = hot water.',
      },
      {
        name: 'vif_code', type: 'integer', unit: '', required: false,
        description: 'Counter unit in use: 0x13 litres, 0x14 decalitres, 0x15 hectolitres, 0x16 m³. Only changes if the counter overflows.',
      },
      { name: 'magnetic_alarm', type: 'boolean', unit: '', required: false, description: 'Magnetic tampering field detected for 10+ minutes.' },
      { name: 'removal_alarm', type: 'boolean', unit: '', required: false, description: 'Module physically removed from the meter.' },
      { name: 'sensor_fraud_alarm', type: 'boolean', unit: '', required: false, description: 'Coil sequence indicates the index is being interfered with.' },
      { name: 'leakage_alarm', type: 'boolean', unit: '', required: false, description: 'Continuous minimum flow detected for 12+ consecutive hours — possible leak.' },
      { name: 'reverse_flow_alarm', type: 'boolean', unit: '', required: false, description: 'More than 20 litres of reverse flow detected.' },
      { name: 'low_battery_alarm', type: 'boolean', unit: '', required: false, description: 'Battery voltage below threshold for 5 consecutive readings.' },
    ],
    decoderFields: [
      { name: 'total_volume', offset: 1, length: 4, type: 'bcd', endian: 'little' },
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
];
