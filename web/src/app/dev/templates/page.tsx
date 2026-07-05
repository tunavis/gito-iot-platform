'use client';

/**
 * DEV-ONLY visual test bench for device illustration templates.
 * Renders every template with labeled sample fixtures so designers can QA
 * materials/motion without a live device. Not linked from any navigation.
 */

import React, { useState } from 'react';
import { TemplateRenderer, resolveTemplate } from '@/components/DeviceTemplates';
import type { TelemetrySchema } from '@/components/DeviceTemplates/types';

interface Fixture {
  title: string;
  category: string;
  schema: TelemetrySchema;
  telemetry: Record<string, number | string | null>;
}

const FIXTURES: Fixture[] = [
  {
    title: 'Water Tank',
    category: 'water_tank',
    schema: {
      tank_level:   { type: 'number', unit: '%',     min: 0, max: 100 },
      inlet_flow:   { type: 'number', unit: 'm³/h',  min: 0, max: 50 },
      outlet_flow:  { type: 'number', unit: 'm³/h',  min: 0, max: 50 },
      temperature:  { type: 'number', unit: '°C' },
      pump_running: { type: 'boolean' },
      pressure:     { type: 'number', unit: 'bar' },
    },
    telemetry: { tank_level: 68, inlet_flow: 22, outlet_flow: 14, temperature: 17.2, pump_running: 1, pressure: 2.4 },
  },
  {
    title: 'Water Meter',
    category: 'water_meter',
    schema: {
      flow_rate:         { type: 'number', unit: 'm³/h', min: 0, max: 100 },
      cumulative_volume: { type: 'number', unit: 'm³' },
      pressure:          { type: 'number', unit: 'bar' },
      temperature:       { type: 'number', unit: '°C' },
    },
    telemetry: { flow_rate: 42.5, cumulative_volume: 15432.8, pressure: 3.1, temperature: 18.4 },
  },
  {
    title: 'Pump',
    category: 'pump',
    schema: {
      running:          { type: 'boolean' },
      speed_rpm:        { type: 'number', unit: 'RPM', min: 0, max: 3000 },
      inlet_pressure:   { type: 'number', unit: 'bar' },
      outlet_pressure:  { type: 'number', unit: 'bar' },
      power_kw:         { type: 'number', unit: 'kW' },
    },
    telemetry: { running: 1, speed_rpm: 2450, inlet_pressure: 1.2, outlet_pressure: 5.8, power_kw: 11.4 },
  },
  {
    title: 'Generator',
    category: 'generator',
    schema: {
      running:      { type: 'boolean' },
      load_percent: { type: 'number', unit: '%', min: 0, max: 100 },
      voltage:      { type: 'number', unit: 'V' },
      frequency:    { type: 'number', unit: 'Hz' },
      fuel_level:   { type: 'number', unit: '%', min: 0, max: 100 },
      engine_temp:  { type: 'number', unit: '°C' },
    },
    telemetry: { running: 1, load_percent: 72, voltage: 231, frequency: 50.02, fuel_level: 58, engine_temp: 84 },
  },
  {
    title: 'Solar System',
    category: 'solar',
    schema: {
      pv_power:    { type: 'number', unit: 'kW' },
      irradiance:  { type: 'number', unit: 'W/m²' },
      battery_soc: { type: 'number', unit: '%', min: 0, max: 100 },
      grid_power:  { type: 'number', unit: 'kW', max: 20 },
      ac_output:   { type: 'number', unit: 'kW' },
    },
    telemetry: { pv_power: 7.8, irradiance: 843, battery_soc: 81, grid_power: 3.2, ac_output: 7.1 },
  },
  {
    title: 'HVAC Unit',
    category: 'hvac',
    schema: {
      supply_temp:     { type: 'number', unit: '°C' },
      return_temp:     { type: 'number', unit: '°C' },
      air_flow:        { type: 'number', unit: 'm³/h', max: 5000 },
      compressor_load: { type: 'number', unit: '%', min: 0, max: 100 },
      cooling_active:  { type: 'boolean' },
    },
    telemetry: { supply_temp: 12.4, return_temp: 23.8, air_flow: 3400, compressor_load: 64, cooling_active: 1 },
  },
];

export default function TemplateBench() {
  const [offline, setOffline] = useState(false);
  const [idle, setIdle] = useState(false);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-page)', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <h1 style={{ color: 'var(--color-text-primary)', fontSize: 18, fontWeight: 700 }}>
          Device Template Bench
        </h1>
        <label style={{ color: 'var(--color-text-muted)', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={offline} onChange={e => setOffline(e.target.checked)} />
          Offline state
        </label>
        <label style={{ color: 'var(--color-text-muted)', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={idle} onChange={e => setIdle(e.target.checked)} />
          Zero-activity values
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 20 }}>
        {FIXTURES.map(f => {
          const config = resolveTemplate(f.category, f.schema);
          if (!config) return null;
          const telemetry = idle
            ? Object.fromEntries(Object.keys(f.telemetry).map(k => [k, 0]))
            : f.telemetry;
          return (
            <div key={f.title} style={{
              border: '1px solid var(--color-border)', borderRadius: 12,
              background: 'var(--color-surface)', padding: 16,
            }}>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                {f.title}
              </div>
              <TemplateRenderer
                config={config}
                telemetry={telemetry}
                deviceStatus={offline ? 'offline' : 'online'}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
