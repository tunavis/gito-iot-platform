# Telemetry-Reactive Animation System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 7 CSS animation primitives and enhance/create 14 device templates that animate based on live telemetry, with offline state handling.

**Architecture:** Reusable SVG animation primitives (`Spinner`, `DashFlow`, `WaveLevel`, etc.) composed by device templates. Each primitive accepts `intensity` (0-1), `paused`, and `color`. Templates normalize raw telemetry to intensity. `TemplateRenderer` handles offline badge and greyscale filter.

**Note:** The spec lists 8 primitives (`FlowParticles` + `DashFlow`). These are intentionally merged into a single `DashFlow` primitive — both use `stroke-dashoffset` animation with the same underlying technique. `DashFlow` handles both directional flow and general flowing particles via its `intensity` and direction props.

**Note:** The existing `FlowLine.tsx` component (in `visualization/`) is used by overlay widgets positioned in DOM space. `DashFlow` serves a different purpose — it animates flow *inside* SVG templates in SVG coordinate space. Both coexist; `FlowLine` is not deprecated.

**Tech Stack:** React 18, TypeScript, CSS animations, SVG, Next.js 14

**Spec:** `docs/superpowers/specs/2026-03-19-telemetry-reactive-animation-system-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `web/src/components/DeviceTemplates/primitives/types.ts` | Shared `AnimationPrimitiveProps` interface |
| `web/src/components/DeviceTemplates/primitives/Spinner.tsx` | Rotating element (fans, impellers, motors) |
| `web/src/components/DeviceTemplates/primitives/DashFlow.tsx` | Flowing dashes along a line (pipe flow) |
| `web/src/components/DeviceTemplates/primitives/WaveLevel.tsx` | Animated wave fill (tanks, boreholes) |
| `web/src/components/DeviceTemplates/primitives/PulseRing.tsx` | Expanding/fading ring (activity indicator) |
| `web/src/components/DeviceTemplates/primitives/HeatGradient.tsx` | 4-step color gradient (temperature, soil) |
| `web/src/components/DeviceTemplates/primitives/ArcSweep.tsx` | Arc position indicator (gauge needles, valve handles) |
| `web/src/components/DeviceTemplates/primitives/Blink.tsx` | Blinking dot (status LEDs, alarms) |
| `web/src/components/DeviceTemplates/primitives/index.ts` | Barrel export for all primitives |
| `web/src/components/DeviceTemplates/primitives/resolveNumeric.ts` | Shared telemetry key resolution utility |
| `web/src/components/DeviceTemplates/OfflineBadge.tsx` | SVG offline overlay badge |
| `web/src/components/DeviceTemplates/templates/TempHumidityTemplate.tsx` | Temperature/humidity sensor |
| `web/src/components/DeviceTemplates/templates/PowerMeterTemplate.tsx` | Electrical panel monitor |
| `web/src/components/DeviceTemplates/templates/ValveTemplate.tsx` | Gate/ball valve |
| `web/src/components/DeviceTemplates/templates/GenericSensorTemplate.tsx` | Universal fallback sensor |
| `web/src/components/DeviceTemplates/templates/BoreholeTemplate.tsx` | Deep well with submersible pump |
| `web/src/components/DeviceTemplates/templates/SoilProbeTemplate.tsx` | Soil moisture cross-section |
| `web/src/components/DeviceTemplates/templates/FuelTankTemplate.tsx` | Diesel/petrol tank |
| `web/src/components/DeviceTemplates/templates/IrrigationTemplate.tsx` | Pipe network with spray zones |

### Modified Files

| File | Changes |
|------|---------|
| `web/src/components/DeviceTemplates/TemplateRenderer.tsx:28-32` | Add `deviceStatus` to `TemplateProps`, extend `ViewBoxCrop` with `x`/`w`, add `OfflineBadge` rendering, add offline CSS class |
| `web/src/components/DeviceTemplates/types.ts:13-19` | Extend `TemplateName` union with 8 new template names |
| `web/src/components/DeviceTemplates/TemplateRenderer.tsx:34-53` | Add 8 new entries to `TEMPLATE_MAP` and `TEMPLATE_CROPS` |
| `web/src/components/visualization/DeviceVisualization.tsx:183` | Pass `deviceStatus` to `TemplateRenderer` |
| `web/src/components/DeviceTemplates/resolveTemplate.ts` | Add keyword mappings + overlay builders for 8 new templates |
| `web/src/components/DeviceTemplates/templates/WaterTankTemplate.tsx` | Replace inline wave code with `WaveLevel` primitive, add `DashFlow` on pipes |
| `web/src/components/DeviceTemplates/templates/PumpTemplate.tsx` | Add `Spinner` on impeller, `DashFlow` on pipes, `PulseRing` on motor |
| `web/src/components/DeviceTemplates/templates/WaterMeterTemplate.tsx` | Add `ArcSweep` on needle, `DashFlow` on pipes |
| `web/src/components/DeviceTemplates/templates/GeneratorTemplate.tsx` | Add `Spinner` on flywheel, `Blink` on LED, `DashFlow` on fuel line |
| `web/src/components/DeviceTemplates/templates/SolarTemplate.tsx` | Add `HeatGradient` on panels, `DashFlow` on cables, `Blink` on inverter LED |
| `web/src/components/DeviceTemplates/templates/HvacTemplate.tsx` | Add `Spinner` on fan, `DashFlow` on ducts, `HeatGradient` on coil |
| `web/src/app/globals.css` | Add offline transition classes, `prefers-reduced-motion` media query |

---

## Task 1: Shared Types & Telemetry Resolver

**Files:**
- Create: `web/src/components/DeviceTemplates/primitives/types.ts`
- Create: `web/src/components/DeviceTemplates/primitives/resolveNumeric.ts`

- [ ] **Step 1: Create the shared animation primitive interface**

```typescript
// web/src/components/DeviceTemplates/primitives/types.ts
export interface AnimationPrimitiveProps {
  /** 0-1 normalized intensity — maps telemetry to animation speed/magnitude */
  intensity: number;
  /** true when device offline — freezes animation */
  paused: boolean;
  /** System color (e.g. '#3b82f6' for water) */
  color: string;
}
```

- [ ] **Step 2: Create the telemetry key resolution utility**

```typescript
// web/src/components/DeviceTemplates/primitives/resolveNumeric.ts
export const LEVEL_KEYS = ['tank_level', 'level', 'fill_level', 'volume_percent', 'fill', 'water_level', 'fuel_level'];
export const FLOW_KEYS = ['flow_rate', 'flow', 'flowrate', 'water_flow', 'rate', 'throughput'];
export const RPM_KEYS = ['rpm', 'speed', 'motor_speed', 'fan_speed', 'rotor_speed', 'pump_rpm'];
export const TEMP_KEYS = ['temperature', 'temp', 'supply_temp', 'return_temp', 'ambient_temp'];
export const HUMIDITY_KEYS = ['humidity', 'relative_humidity', 'rh'];
export const POWER_KEYS = ['power', 'watts', 'kw', 'load', 'output_power', 'active_power'];
export const PRESSURE_KEYS = ['pressure', 'psi', 'bar', 'inlet_pressure', 'outlet_pressure'];
export const MOISTURE_KEYS = ['moisture', 'soil_moisture', 'volumetric_water_content', 'vwc'];
export const POSITION_KEYS = ['position', 'valve_position', 'opening', 'percent_open'];
export const IRRADIANCE_KEYS = ['irradiance', 'solar_irradiance', 'ghi', 'radiation'];

/**
 * Search telemetry for the first matching key from candidates.
 * Returns the numeric value or fallback.
 */
export function resolveNumeric(
  telemetry: Record<string, number | string | null> | undefined,
  keys: string[],
  fallback = 0
): number {
  if (!telemetry) return fallback;
  for (const k of keys) {
    const v = telemetry[k];
    if (v !== null && v !== undefined && !isNaN(Number(v))) return Number(v);
  }
  return fallback;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors related to the new files.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/DeviceTemplates/primitives/types.ts web/src/components/DeviceTemplates/primitives/resolveNumeric.ts
git commit -m "feat(viz): add animation primitive types and telemetry key resolver"
```

---

## Task 2: DashFlow Primitive

**Files:**
- Create: `web/src/components/DeviceTemplates/primitives/DashFlow.tsx`

This is the most commonly used primitive (pipes, cables, ducts). Build it first.

- [ ] **Step 1: Create DashFlow component**

The component renders an SVG line with animated `stroke-dashoffset` that scrolls dashes along the line. Speed scales with intensity.

```tsx
// web/src/components/DeviceTemplates/primitives/DashFlow.tsx
'use client';
import React, { useId } from 'react';

interface DashFlowProps {
  /** Start x coordinate in SVG space */
  x1: number;
  /** Start y coordinate */
  y1: number;
  /** End x coordinate */
  x2: number;
  /** End y coordinate */
  y2: number;
  /** 0-1 normalized flow intensity */
  intensity: number;
  /** Freeze when offline */
  paused: boolean;
  /** Pipe color */
  color: string;
  /** Stroke width (default 4) */
  strokeWidth?: number;
  /** Shadow color for 3D depth (darker shade) */
  shadowColor?: string;
  /** Highlight color (lighter shade) */
  highlightColor?: string;
}

export function DashFlow({
  x1, y1, x2, y2,
  intensity,
  paused,
  color,
  strokeWidth = 4,
  shadowColor,
  highlightColor,
}: DashFlowProps) {
  const id = useId();
  // Dead zone — no animation below 5%
  const active = intensity > 0.05 && !paused;
  // Duration: 0.4s at max → 3s at near-zero
  const duration = active ? 0.4 + (1 - intensity) * 2.6 : 0;
  const dashLen = 8;
  const gapLen = 6;
  const totalDash = dashLen + gapLen;

  return (
    <g className={paused ? 'device-primitive--paused' : ''}>
      {/* Shadow for depth */}
      {shadowColor && (
        <line x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={shadowColor} strokeWidth={strokeWidth + 4}
          strokeLinecap="round" strokeOpacity={0.3} />
      )}
      {/* Pipe body */}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={strokeWidth + 2}
        strokeLinecap="round" strokeOpacity={0.25} />
      {/* Animated dashes */}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${dashLen} ${gapLen}`}
        strokeOpacity={0.3 + intensity * 0.6}
        style={active ? {
          animation: `dashflow-${id.replace(/:/g, '')} ${duration}s linear infinite`,
        } : undefined}
      />
      {/* Highlight */}
      {highlightColor && (
        <line x1={x1} y1={y1 - 1} x2={x2} y2={y2 - 1}
          stroke={highlightColor} strokeWidth={1.5}
          strokeLinecap="round" strokeOpacity={0.3} />
      )}
      {/* Scoped keyframe — uses useId for uniqueness */}
      {active && (
        <style>{`
          @keyframes dashflow-${id.replace(/:/g, '')} {
            to { stroke-dashoffset: -${totalDash}px; }
          }
          /* prefers-reduced-motion handled globally in globals.css — no per-primitive rule needed */
        `}</style>
      )}
    </g>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/primitives/DashFlow.tsx
git commit -m "feat(viz): add DashFlow animation primitive"
```

---

## Task 3: Spinner Primitive

**Files:**
- Create: `web/src/components/DeviceTemplates/primitives/Spinner.tsx`

Rotating element for fans, impellers, and motor shafts.

- [ ] **Step 1: Create Spinner component**

```tsx
// web/src/components/DeviceTemplates/primitives/Spinner.tsx
'use client';
import React, { useId } from 'react';

interface SpinnerProps {
  /** Center x in SVG space */
  cx: number;
  /** Center y in SVG space */
  cy: number;
  /** Children to rotate (e.g., blade group) */
  children: React.ReactNode;
  /** 0-1 rotation speed intensity */
  intensity: number;
  /** Freeze when offline */
  paused: boolean;
}

export function Spinner({ cx, cy, children, intensity, paused }: SpinnerProps) {
  const id = useId();
  const animId = `spin-${id.replace(/:/g, '')}`;
  // Dead zone: below 5% = stopped
  const active = intensity > 0.05 && !paused;
  // Duration: 0.5s (max) → 4s (min)
  const duration = active ? 0.5 + (1 - intensity) * 3.5 : 0;

  return (
    <g
      style={active ? {
        transformOrigin: `${cx}px ${cy}px`,
        animation: `${animId} ${duration}s linear infinite`,
        willChange: 'transform',
      } : {
        transformOrigin: `${cx}px ${cy}px`,
      }}
    >
      {children}
      {active && (
        <style>{`
          @keyframes ${animId} {
            to { transform: rotate(360deg); }
          }
          /* prefers-reduced-motion handled globally in globals.css */
        `}</style>
      )}
    </g>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/primitives/Spinner.tsx
git commit -m "feat(viz): add Spinner animation primitive"
```

---

## Task 4: PulseRing Primitive

**Files:**
- Create: `web/src/components/DeviceTemplates/primitives/PulseRing.tsx`

Expanding, fading ring for activity/signal indicators.

- [ ] **Step 1: Create PulseRing component**

```tsx
// web/src/components/DeviceTemplates/primitives/PulseRing.tsx
'use client';
import React, { useId } from 'react';

interface PulseRingProps {
  cx: number;
  cy: number;
  r: number;
  intensity: number;
  paused: boolean;
  color: string;
}

export function PulseRing({ cx, cy, r, intensity, paused, color }: PulseRingProps) {
  const id = useId();
  const animId = `pulse-${id.replace(/:/g, '')}`;
  const active = intensity > 0.05 && !paused;
  // Pulse period: 0.6s (max) → 2.5s (min)
  const duration = active ? 0.6 + (1 - intensity) * 1.9 : 0;

  return (
    <g>
      {/* Static core dot */}
      <circle cx={cx} cy={cy} r={r * 0.4} fill={color} fillOpacity={active ? 0.9 : 0.3} />
      {/* Expanding ring */}
      {active && (
        <>
          <circle
            cx={cx} cy={cy} r={r}
            fill="none" stroke={color} strokeWidth={2}
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              animation: `${animId} ${duration}s ease-out infinite`,
            }}
          />
          <style>{`
            @keyframes ${animId} {
              0%   { opacity: 0.7; transform: scale(0.5); }
              100% { opacity: 0;   transform: scale(1.5); }
            }
            /* prefers-reduced-motion handled globally in globals.css */
          `}</style>
        </>
      )}
    </g>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/primitives/PulseRing.tsx
git commit -m "feat(viz): add PulseRing animation primitive"
```

---

## Task 5: Blink Primitive

**Files:**
- Create: `web/src/components/DeviceTemplates/primitives/Blink.tsx`

Blinking LED/status indicator.

- [ ] **Step 1: Create Blink component**

```tsx
// web/src/components/DeviceTemplates/primitives/Blink.tsx
'use client';
import React, { useId } from 'react';

interface BlinkProps {
  cx: number;
  cy: number;
  r: number;
  /** 0-1 urgency/blink rate */
  intensity: number;
  paused: boolean;
  /** LED color (default green) */
  color?: string;
  /** Active/on color glow */
  glowColor?: string;
}

export function Blink({ cx, cy, r, intensity, paused, color = '#22c55e', glowColor }: BlinkProps) {
  const id = useId();
  const animId = `blink-${id.replace(/:/g, '')}`;
  const active = intensity > 0.05 && !paused;
  // Blink period: 0.3s (urgent) → 2s (calm)
  const duration = active ? 0.3 + (1 - intensity) * 1.7 : 0;

  return (
    <g>
      {/* Glow halo */}
      {active && glowColor && (
        <circle cx={cx} cy={cy} r={r * 2} fill={glowColor} fillOpacity={0.15} />
      )}
      {/* LED body */}
      <circle cx={cx} cy={cy} r={r} fill={color}
        fillOpacity={active ? 0.9 : 0.2}
        style={active ? {
          animation: `${animId} ${duration}s ease-in-out infinite`,
        } : undefined}
      />
      {/* Specular highlight */}
      <circle cx={cx - r * 0.25} cy={cy - r * 0.25} r={r * 0.35}
        fill="white" fillOpacity={0.4} />
      {active && (
        <style>{`
          @keyframes ${animId} {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          /* prefers-reduced-motion handled globally in globals.css */
        `}</style>
      )}
    </g>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/primitives/Blink.tsx
git commit -m "feat(viz): add Blink animation primitive"
```

---

## Task 6: HeatGradient Primitive

**Files:**
- Create: `web/src/components/DeviceTemplates/primitives/HeatGradient.tsx`

4-step color gradient for temperature and soil moisture visualization.

- [ ] **Step 1: Create HeatGradient component**

```tsx
// web/src/components/DeviceTemplates/primitives/HeatGradient.tsx
'use client';
import React, { useId } from 'react';

interface HeatGradientProps {
  /** SVG element ID to apply gradient as fill */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0-1 normalized value — determines color step */
  intensity: number;
  paused: boolean;
  /** Color steps from low to high (default: cold→hot) */
  steps?: [string, string, string, string];
  /** Gradient direction: 'vertical' (default, bottom→top) or 'horizontal' */
  direction?: 'vertical' | 'horizontal';
  rx?: number;
}

const HEAT_STEPS: [string, string, string, string] = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444'];

export function HeatGradient({
  x, y, width, height,
  intensity,
  paused,
  steps = HEAT_STEPS,
  direction = 'vertical',
  rx = 0,
}: HeatGradientProps) {
  const id = useId();
  const gradId = `hg-${id.replace(/:/g, '')}`;

  // Determine which color step we're in (4 steps = 3 boundaries)
  const stepIndex = Math.min(Math.floor(intensity * 3.99), 3);
  const fillColor = paused ? '#6b7280' : steps[stepIndex];

  const isVertical = direction === 'vertical';

  return (
    <g>
      <defs>
        <linearGradient id={gradId}
          x1={isVertical ? '0' : '0'} y1={isVertical ? '1' : '0'}
          x2={isVertical ? '0' : '1'} y2={isVertical ? '0' : '0'}
        >
          <stop offset="0%" stopColor={steps[0]} stopOpacity={0.2} />
          <stop offset="100%" stopColor={fillColor} stopOpacity={0.6}
            style={{ transition: 'stop-color 0.8s ease' }}
          />
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={width} height={height} rx={rx}
        fill={`url(#${gradId})`}
        style={{ transition: 'fill 0.8s ease' }}
      />
    </g>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/primitives/HeatGradient.tsx
git commit -m "feat(viz): add HeatGradient animation primitive"
```

---

## Task 7: ArcSweep Primitive

**Files:**
- Create: `web/src/components/DeviceTemplates/primitives/ArcSweep.tsx`

Arc path indicator for gauge needles and valve positions.

- [ ] **Step 1: Create ArcSweep component**

```tsx
// web/src/components/DeviceTemplates/primitives/ArcSweep.tsx
'use client';
import React from 'react';

interface ArcSweepProps {
  /** Center x */
  cx: number;
  /** Center y */
  cy: number;
  /** Arc radius */
  r: number;
  /** 0-1 position along the arc */
  intensity: number;
  paused: boolean;
  color: string;
  /** Arc sweep in degrees (default 240) */
  sweep?: number;
  /** Start angle in degrees (default 150 = 7 o'clock) */
  startAngle?: number;
  /** Stroke width (default 3) */
  strokeWidth?: number;
}

function polarToCartesian(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function ArcSweep({
  cx, cy, r,
  intensity,
  paused,
  color,
  sweep = 240,
  startAngle = 150,
  strokeWidth = 3,
}: ArcSweepProps) {
  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  const endAngle = startAngle + sweep;
  const valueAngle = startAngle + sweep * clampedIntensity;
  const displayColor = paused ? '#6b7280' : color;

  return (
    <g>
      {/* Track */}
      <path d={describeArc(cx, cy, r, startAngle, endAngle)}
        fill="none" stroke={displayColor} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeOpacity={0.15} />
      {/* Value arc */}
      {clampedIntensity > 0.01 && (
        <path d={describeArc(cx, cy, r, startAngle, valueAngle)}
          fill="none" stroke={displayColor} strokeWidth={strokeWidth}
          strokeLinecap="round" strokeOpacity={0.8}
          style={{ transition: 'd 0.5s ease, stroke 0.5s ease' }} />
      )}
      {/* Needle dot at current position */}
      {(() => {
        const pos = polarToCartesian(cx, cy, r, valueAngle);
        return (
          <circle cx={pos.x} cy={pos.y} r={strokeWidth}
            fill={displayColor} fillOpacity={0.9}
            style={{ transition: 'cx 0.5s ease, cy 0.5s ease' }} />
        );
      })()}
    </g>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/primitives/ArcSweep.tsx
git commit -m "feat(viz): add ArcSweep animation primitive"
```

---

## Task 8: WaveLevel Primitive

**Files:**
- Create: `web/src/components/DeviceTemplates/primitives/WaveLevel.tsx`

Extracted from WaterTankTemplate — animated wave fill with clipPath.

- [ ] **Step 1: Create WaveLevel component**

```tsx
// web/src/components/DeviceTemplates/primitives/WaveLevel.tsx
'use client';
import React, { useId, useMemo } from 'react';

interface WaveLevelProps {
  /** Tank/container interior bounds */
  containerX: number;
  containerY: number;
  containerWidth: number;
  containerHeight: number;
  /** 0-1 fill level */
  intensity: number;
  paused: boolean;
  /** Fill color */
  color: string;
  /** Lighter shade for wave highlight */
  highlightColor?: string;
  /** Wave animation speed — 0 = still, 1 = active ripple (default: same as intensity) */
  rippleIntensity?: number;
}

export function WaveLevel({
  containerX, containerY, containerWidth, containerHeight,
  intensity,
  paused,
  color,
  highlightColor,
  rippleIntensity,
}: WaveLevelProps) {
  const id = useId();
  const clipId = `wl-clip-${id.replace(/:/g, '')}`;

  const clampedLevel = Math.max(0, Math.min(1, intensity));
  const fillH = containerHeight * clampedLevel;
  const fillY = containerY + containerHeight - fillH;
  const active = clampedLevel > 0.02 && !paused;

  // Wave amplitude scales with level (bigger tank = more visible wave)
  const amp = active ? 3 + clampedLevel * 3 : 0;
  const w = containerWidth;
  const cx = containerX;

  // Two wave states for SVG animate to interpolate between
  const wavePath1 = `M${cx},${fillY} c${w * 0.15},-${amp} ${w * 0.35},-${amp} ${w * 0.5},0 c${w * 0.15},${amp} ${w * 0.35},${amp} ${w * 0.5},0 V${containerY + containerHeight} H${cx} Z`;
  const wavePath2 = `M${cx},${fillY} c${w * 0.15},${amp} ${w * 0.35},${amp} ${w * 0.5},0 c${w * 0.15},-${amp} ${w * 0.35},-${amp} ${w * 0.5},0 V${containerY + containerHeight} H${cx} Z`;

  // Ripple speed: 2s fast → 5s slow
  const rIntensity = rippleIntensity ?? (clampedLevel > 0 ? 0.5 : 0);
  const rippleDur = active ? `${2 + (1 - rIntensity) * 3}s` : '4s';

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={containerX} y={containerY} width={containerWidth} height={containerHeight} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {/* Fill body */}
        {clampedLevel > 0.01 && (
          <>
            <rect x={cx} y={fillY + amp + 1} width={w} height={fillH}
              fill={color} fillOpacity={0.25} />
            {/* Animated wave surface */}
            {active ? (
              <path fill={color} fillOpacity={0.35}>
                <animate attributeName="d"
                  dur={rippleDur} repeatCount="indefinite"
                  values={`${wavePath1};${wavePath2};${wavePath1}`} />
              </path>
            ) : (
              <path d={wavePath1} fill={color} fillOpacity={0.35} />
            )}
            {/* Highlight sheen on left */}
            {highlightColor && (
              <rect x={cx} y={fillY} width={4} height={fillH}
                fill={highlightColor} fillOpacity={0.3} rx={2} />
            )}
          </>
        )}
      </g>
    </g>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/primitives/WaveLevel.tsx
git commit -m "feat(viz): add WaveLevel animation primitive (extracted from WaterTankTemplate)"
```

---

## Task 9: Barrel Export + Primitives Index

**Files:**
- Create: `web/src/components/DeviceTemplates/primitives/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// web/src/components/DeviceTemplates/primitives/index.ts
export { DashFlow } from './DashFlow';
export { Spinner } from './Spinner';
export { PulseRing } from './PulseRing';
export { Blink } from './Blink';
export { HeatGradient } from './HeatGradient';
export { ArcSweep } from './ArcSweep';
export { WaveLevel } from './WaveLevel';
export * from './resolveNumeric';  // resolveNumeric + key arrays (LEVEL_KEYS, etc.)
export type { AnimationPrimitiveProps } from './types';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/primitives/index.ts
git commit -m "feat(viz): add primitives barrel export"
```

---

## Task 10: OfflineBadge + CSS + TemplateRenderer Integration

**Files:**
- Create: `web/src/components/DeviceTemplates/OfflineBadge.tsx`
- Modify: `web/src/components/DeviceTemplates/TemplateRenderer.tsx`
- Modify: `web/src/components/visualization/DeviceVisualization.tsx:183`
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Create OfflineBadge component**

```tsx
// web/src/components/DeviceTemplates/OfflineBadge.tsx
import React from 'react';

interface OfflineBadgeCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function OfflineBadge({ crop }: { crop: OfflineBadgeCrop }) {
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  return (
    <g>
      <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h}
        fill="black" fillOpacity="0.3" rx="8" />
      <rect x={cx - 75} y={cy - 25} width="150" height="50" rx="8"
        fill="#1e293b" stroke="#475569" strokeWidth="2" />
      <circle cx={cx - 45} cy={cy} r="6" fill="#ef4444" />
      <text x={cx + 10} y={cy + 6} textAnchor="middle"
        style={{ fill: '#94a3b8', fontSize: 14, fontWeight: 600, fontFamily: 'system-ui,sans-serif' }}>
        OFFLINE
      </text>
    </g>
  );
}
```

- [ ] **Step 2: Add offline CSS classes to globals.css**

Append to the end of `web/src/app/globals.css`:

```css
/* Device template offline state — targets .device-template-content (a <g> wrapping the template),
   NOT the whole <svg>, so the OfflineBadge renders in full color on top of greyed content. */
.device-template--offline .device-template-content {
  filter: grayscale(1) brightness(0.7);
  transition: filter 0.6s ease;
}
.device-template--online .device-template-content {
  filter: none;
  transition: filter 0.6s ease;
}

/* Global reduced-motion: disable all device-template animations */
@media (prefers-reduced-motion: reduce) {
  .device-template--online svg *,
  .device-template--offline svg * {
    animation: none !important;
    transition: none !important;
  }
}
```

In `TemplateRenderer`, wrap the `<Template>` in a `<g className="device-template-content">` so the filter applies only to the template content, not the OfflineBadge. The OfflineBadge renders as a sibling `<g>` outside this wrapper.

- [ ] **Step 3: Update TemplateRenderer — add deviceStatus prop, OfflineBadge, CSS class**

Modify `web/src/components/DeviceTemplates/TemplateRenderer.tsx`:

1. Add `deviceStatus` to `TemplateProps` interface (line 28-32):
   ```typescript
   export interface TemplateProps {
     width: number;
     height: number;
     telemetry?: Record<string, number | string | null>;
     deviceStatus?: 'online' | 'offline' | 'unknown';
   }
   ```

2. Add `deviceStatus` to `TemplateRendererProps` (line 55-59):
   ```typescript
   interface TemplateRendererProps {
     config: TemplateConfig;
     telemetry: Record<string, number | string | null>;
     deviceStatus?: 'online' | 'offline' | 'unknown';
   }
   ```

3. Import `OfflineBadge` and update the render function to:
   - Accept `deviceStatus` from props
   - Add CSS class `device-template--offline` or `device-template--online` to container div
   - Pass `deviceStatus` to the template component
   - Render `OfflineBadge` inside the SVG when offline

4. The `crop` object already has `y` and `h` — for the badge, use `x: 0, w: 500` (all templates use full width).

- [ ] **Step 4: Update DeviceVisualization to pass deviceStatus to TemplateRenderer**

In `web/src/components/visualization/DeviceVisualization.tsx`, line 183 currently reads:
```tsx
<TemplateRenderer config={templateConfig} telemetry={latestValues} />
```

Change to:
```tsx
<TemplateRenderer config={templateConfig} telemetry={latestValues} deviceStatus={deviceStatus as 'online' | 'offline' | 'unknown'} />
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 6: Commit**

```bash
git add web/src/components/DeviceTemplates/OfflineBadge.tsx web/src/components/DeviceTemplates/TemplateRenderer.tsx web/src/components/visualization/DeviceVisualization.tsx web/src/app/globals.css
git commit -m "feat(viz): add OfflineBadge, offline CSS, and deviceStatus plumbing"
```

---

## Task 11: Enhance Existing Templates — PumpTemplate

**Files:**
- Modify: `web/src/components/DeviceTemplates/templates/PumpTemplate.tsx`

The pump is the best showcase template — spinning impeller, flowing pipes, motor LED.

**IMPORTANT — applies to ALL existing template enhancements (Tasks 11-16):**
1. Each existing template currently renders its own `<svg>` wrapper, but `TemplateRenderer` already wraps them in an `<svg>`. The templates return nested SVGs which works fine — do NOT change the `<svg>` to `<g>` as it would break standalone rendering. The animation primitives work correctly inside the inner SVG.
2. Each template must import `TemplateProps` from `'../TemplateRenderer'` and use it as the component's props type (replacing the inline `{ width, height, telemetry? }` type). This gives access to the new `deviceStatus` prop.
3. Destructure `deviceStatus` from props and compute `const paused = deviceStatus !== 'online';` — pass `paused` to all primitives.

- [ ] **Step 1: Add animation primitives to PumpTemplate**

Import `TemplateProps` from `'../TemplateRenderer'`, primitives and `resolveNumeric` at the top. Keep all existing static SVG. Add:

1. **Spinner** wrapping the existing impeller blades (lines 45-55 in current file) — the 6 `<line>` elements that form the blades get wrapped in a `<Spinner cx={250} cy={220}>` group
2. **DashFlow** on the inlet pipe (x1=30, y1=200, x2=175, y2=200, color="#3b82f6", shadowColor="#1d4ed8", highlightColor="#93c5fd")
3. **DashFlow** on the outlet pipe (x1=325, y1=200, x2=470, y2=200, color="#f97316", shadowColor="#c2410c", highlightColor="#fed7aa")
4. **PulseRing** on the motor (cx=250, cy=131) — active when rpm > 0

Telemetry resolution:
```typescript
const paused = deviceStatus !== 'online';
const rpm = resolveNumeric(telemetry, RPM_KEYS);
const flow = resolveNumeric(telemetry, FLOW_KEYS);
const rpmIntensity = Math.min(rpm / 3000, 1);
const flowIntensity = Math.min(flow / 100, 1);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/templates/PumpTemplate.tsx
git commit -m "feat(viz): enhance PumpTemplate with Spinner, DashFlow, PulseRing animations"
```

---

## Task 12: Enhance WaterTankTemplate

**Files:**
- Modify: `web/src/components/DeviceTemplates/templates/WaterTankTemplate.tsx`

Replace the existing inline wave animation with the `WaveLevel` primitive. Add `DashFlow` on pipes.

- [ ] **Step 1: Refactor WaterTankTemplate**

1. Remove `findLevelValue()` function — replace with `resolveNumeric(telemetry, LEVEL_KEYS)`
2. Remove the inline `wavePath`, `<clipPath>`, `<animate>` code
3. Add `<WaveLevel>` primitive with the tank interior bounds (containerX=185, containerY=64, containerWidth=164, containerHeight=272)
4. Add `<DashFlow>` on inlet and outlet pipes
5. Accept `deviceStatus` from props

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/templates/WaterTankTemplate.tsx
git commit -m "feat(viz): refactor WaterTankTemplate to use WaveLevel and DashFlow primitives"
```

---

## Task 13: Enhance WaterMeterTemplate

**Files:**
- Modify: `web/src/components/DeviceTemplates/templates/WaterMeterTemplate.tsx`

- [ ] **Step 1: Add ArcSweep and DashFlow to WaterMeterTemplate**

1. Add `ArcSweep` centered on the existing needle position (cx=250, cy=182) — intensity from flow_rate
2. Add `DashFlow` on inlet pipe (x1=30, y1=200, x2=172, y2=200) and outlet pipe (x1=328, y1=200, x2=470, y2=200)
3. Remove or overlay the static needle `<line>` — the ArcSweep replaces the visual needle

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/templates/WaterMeterTemplate.tsx
git commit -m "feat(viz): enhance WaterMeterTemplate with ArcSweep and DashFlow"
```

---

## Task 14: Enhance GeneratorTemplate

**Files:**
- Modify: `web/src/components/DeviceTemplates/templates/GeneratorTemplate.tsx`

- [ ] **Step 1: Add Spinner, Blink, DashFlow to GeneratorTemplate**

1. **Spinner** wrapping the piston group (lines 35-37) — intensity from rpm
2. **Blink** on a status LED position (near the alternator, e.g., cx=400, cy=150) — active when power > 0
3. **DashFlow** on the fuel line (x1=245, y1=268, x2=305, y2=268) — replaces the static dashed line

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/templates/GeneratorTemplate.tsx
git commit -m "feat(viz): enhance GeneratorTemplate with Spinner, Blink, DashFlow"
```

---

## Task 15: Enhance SolarTemplate

**Files:**
- Modify: `web/src/components/DeviceTemplates/templates/SolarTemplate.tsx`

- [ ] **Step 1: Add HeatGradient, DashFlow, Blink to SolarTemplate**

1. **HeatGradient** overlaid on the PV array area — intensity from irradiance (glow effect when sunlight is strong)
2. **DashFlow** on the DC cable path (from panel to inverter) — intensity from power
3. **DashFlow** on the AC cable (inverter to grid) — intensity from power
4. **Blink** on the inverter LED (existing cx=267, cy=221) — replace static green circle with animated Blink

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/templates/SolarTemplate.tsx
git commit -m "feat(viz): enhance SolarTemplate with HeatGradient, DashFlow, Blink"
```

---

## Task 16: Enhance HvacTemplate

**Files:**
- Modify: `web/src/components/DeviceTemplates/templates/HvacTemplate.tsx`

- [ ] **Step 1: Add Spinner, DashFlow, HeatGradient to HvacTemplate**

1. **Spinner** wrapping the fan blades group (lines 97-108) — intensity from fan_speed
2. **DashFlow** on return duct (x1=30, y1=200, x2=115, y2=200, color=RET) — replaces static arrow
3. **DashFlow** on supply duct (x1=385, y1=200, x2=470, y2=200, color=SUP) — replaces static arrow
4. **HeatGradient** on the coil section (x=190, y=95, width=60, height=210) — intensity from supply_temp

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DeviceTemplates/templates/HvacTemplate.tsx
git commit -m "feat(viz): enhance HvacTemplate with Spinner, DashFlow, HeatGradient"
```

---

## Task 17: Update TemplateName Type + Integration Points for New Templates

**Files:**
- Modify: `web/src/components/DeviceTemplates/types.ts:13-19`

- [ ] **Step 1: Extend TemplateName union**

```typescript
export type TemplateName =
  | 'water_tank'
  | 'water_meter'
  | 'pump'
  | 'generator'
  | 'solar_system'
  | 'hvac_unit'
  // Tier 1
  | 'temp_humidity'
  | 'power_meter'
  | 'valve'
  | 'generic_sensor'
  // Tier 2
  | 'borehole'
  | 'soil_probe'
  | 'fuel_tank'
  | 'irrigation';
```

- [ ] **Step 2: Change TEMPLATE_MAP and TEMPLATE_CROPS to Partial<Record>**

In `TemplateRenderer.tsx`, change:
```typescript
// Before:
const TEMPLATE_MAP: Record<TemplateConfig['template'], React.FC<TemplateProps>> = { ... };
const TEMPLATE_CROPS: Record<TemplateConfig['template'], ViewBoxCrop> = { ... };

// After:
const TEMPLATE_MAP: Partial<Record<TemplateConfig['template'], React.FC<TemplateProps>>> = { ... };
const TEMPLATE_CROPS: Partial<Record<TemplateConfig['template'], ViewBoxCrop>> = { ... };
```

Also update the BUILDERS record in `resolveTemplate.ts` to `Partial<Record<...>>` if it's similarly typed.

This allows adding new TemplateName values without requiring all keys to exist immediately.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: Zero errors — Partial allows missing keys.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/DeviceTemplates/types.ts web/src/components/DeviceTemplates/TemplateRenderer.tsx web/src/components/DeviceTemplates/resolveTemplate.ts
git commit -m "feat(viz): extend TemplateName union with 8 new types, use Partial<Record> for maps"
```

---

## Task 18: TempHumidityTemplate (Tier 1)

**Files:**
- Create: `web/src/components/DeviceTemplates/templates/TempHumidityTemplate.tsx`
- Modify: `web/src/components/DeviceTemplates/TemplateRenderer.tsx` (add to TEMPLATE_MAP + TEMPLATE_CROPS)

- [ ] **Step 1: Create TempHumidityTemplate**

SVG design: Mercury thermometer on left, humidity droplet on right. 500×400 viewBox.

- Thermometer tube (rect + rounded top circle) with `HeatGradient` fill driven by `temperature`
- Humidity droplet icon with `PulseRing` — pulse rate driven by `humidity` value
- Scale markings on thermometer (-20°C to 60°C range)
- Labels: "TEMPERATURE", "HUMIDITY"

- [ ] **Step 2: Register in TemplateRenderer**

Add to `TEMPLATE_MAP`:
```typescript
temp_humidity: TempHumidityTemplate,
```

Add to `TEMPLATE_CROPS`:
```typescript
temp_humidity: { y: 40, h: 320 },
```

- [ ] **Step 3: Add to resolveTemplate.ts**

Add keyword mapping:
```typescript
temp_humidity: ['temperature', 'temp_humidity', 'climate', 'environment', 'dht', 'sht', 'bme']
```

Add overlay builder `buildTempHumidityOverlays()`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DeviceTemplates/templates/TempHumidityTemplate.tsx web/src/components/DeviceTemplates/TemplateRenderer.tsx web/src/components/DeviceTemplates/resolveTemplate.ts
git commit -m "feat(viz): add TempHumidityTemplate with HeatGradient and PulseRing"
```

---

## Task 19: PowerMeterTemplate (Tier 1)

**Files:**
- Create: `web/src/components/DeviceTemplates/templates/PowerMeterTemplate.tsx`
- Modify: `web/src/components/DeviceTemplates/TemplateRenderer.tsx`
- Modify: `web/src/components/DeviceTemplates/resolveTemplate.ts`

- [ ] **Step 1: Create PowerMeterTemplate**

SVG design: Electrical panel with breakers, cable entry, load gauge. 500×400 viewBox.

- Panel housing (rect with rounded corners)
- Breaker rows (rect elements)
- `ArcSweep` gauge showing load_percent
- `DashFlow` on input cable (energy amber color)
- `Blink` LED for alarm state
- Labels: "POWER METER", "LOAD"

- [ ] **Step 2: Register in TemplateRenderer + resolveTemplate**

Keywords: `['power_meter', 'energy_meter', 'electricity', 'electrical', 'ct_clamp', 'smart_meter']`

- [ ] **Step 3: Verify TypeScript compiles and commit**

```bash
git add web/src/components/DeviceTemplates/templates/PowerMeterTemplate.tsx web/src/components/DeviceTemplates/TemplateRenderer.tsx web/src/components/DeviceTemplates/resolveTemplate.ts
git commit -m "feat(viz): add PowerMeterTemplate with ArcSweep, DashFlow, Blink"
```

---

## Task 20: ValveTemplate (Tier 1)

**Files:**
- Create: `web/src/components/DeviceTemplates/templates/ValveTemplate.tsx`
- Modify: `web/src/components/DeviceTemplates/TemplateRenderer.tsx`
- Modify: `web/src/components/DeviceTemplates/resolveTemplate.ts`

- [ ] **Step 1: Create ValveTemplate**

SVG design: Gate/ball valve with handle, upstream and downstream pipes. 500×400 viewBox.

- Pipe sections (left and right)
- Valve body (circle or hexagonal housing)
- Handle/actuator (top, rotated by `ArcSweep` based on `position`)
- `DashFlow` on downstream pipe — flow rate proportional to valve position
- When valve position is 0 (closed), DashFlow intensity = 0
- Labels: "INLET", "OUTLET", "VALVE"

- [ ] **Step 2: Register in TemplateRenderer + resolveTemplate**

Keywords: `['valve', 'actuator', 'gate_valve', 'ball_valve', 'butterfly_valve', 'solenoid']`

- [ ] **Step 3: Verify TypeScript compiles and commit**

```bash
git add web/src/components/DeviceTemplates/templates/ValveTemplate.tsx web/src/components/DeviceTemplates/TemplateRenderer.tsx web/src/components/DeviceTemplates/resolveTemplate.ts
git commit -m "feat(viz): add ValveTemplate with ArcSweep and DashFlow"
```

---

## Task 21: GenericSensorTemplate (Tier 1)

**Files:**
- Create: `web/src/components/DeviceTemplates/templates/GenericSensorTemplate.tsx`
- Modify: `web/src/components/DeviceTemplates/TemplateRenderer.tsx`
- Modify: `web/src/components/DeviceTemplates/resolveTemplate.ts`

- [ ] **Step 1: Create GenericSensorTemplate**

SVG design: Universal sensor icon with signal rings. 500×400 viewBox.

- Sensor body (rounded rect or capsule shape)
- Antenna/signal icon
- `PulseRing` — intensity from first non-status numeric telemetry key
- `Blink` LED — heartbeat when online
- Labels: "SENSOR"

This is the fallback template — used when no other template matches.

- [ ] **Step 2: Register in TemplateRenderer + resolveTemplate**

Keywords: `['sensor', 'generic', 'monitor', 'probe', 'detector', 'transmitter']`

Also update `resolveTemplate` so that `generic_sensor` is the fallback when category is provided but no other template matches.

- [ ] **Step 3: Verify TypeScript compiles and commit**

```bash
git add web/src/components/DeviceTemplates/templates/GenericSensorTemplate.tsx web/src/components/DeviceTemplates/TemplateRenderer.tsx web/src/components/DeviceTemplates/resolveTemplate.ts
git commit -m "feat(viz): add GenericSensorTemplate as universal fallback"
```

---

## Task 22: BoreholeTemplate (Tier 2)

**Files:**
- Create: `web/src/components/DeviceTemplates/templates/BoreholeTemplate.tsx`
- Modify: `web/src/components/DeviceTemplates/TemplateRenderer.tsx`
- Modify: `web/src/components/DeviceTemplates/resolveTemplate.ts`

- [ ] **Step 1: Create BoreholeTemplate**

SVG design: Cross-section of a deep well. 500×400 viewBox.

- Ground level with surface (brown soil + green grass line)
- Well casing (vertical rect going deep)
- Rock/soil layers at different depths (textured rects)
- `WaveLevel` showing water table level — intensity from `water_table`
- Submersible pump icon at bottom of well — `Spinner` from `pump_rpm`
- Riser pipe from pump to surface — `DashFlow` from `flow`
- Control box at surface with `Blink` LED
- Labels: "BOREHOLE", "WATER TABLE"

- [ ] **Step 2: Register in TemplateRenderer + resolveTemplate**

Keywords: `['borehole', 'well', 'groundwater', 'submersible', 'deep_well', 'aquifer']`

- [ ] **Step 3: Verify TypeScript compiles and commit**

```bash
git add web/src/components/DeviceTemplates/templates/BoreholeTemplate.tsx web/src/components/DeviceTemplates/TemplateRenderer.tsx web/src/components/DeviceTemplates/resolveTemplate.ts
git commit -m "feat(viz): add BoreholeTemplate with WaveLevel, Spinner, DashFlow"
```

---

## Task 23: SoilProbeTemplate (Tier 2)

**Files:**
- Create: `web/src/components/DeviceTemplates/templates/SoilProbeTemplate.tsx`
- Modify: `web/src/components/DeviceTemplates/TemplateRenderer.tsx`
- Modify: `web/src/components/DeviceTemplates/resolveTemplate.ts`

- [ ] **Step 1: Create SoilProbeTemplate**

SVG design: Soil cross-section with probe inserted. 500×400 viewBox.

- Surface level (grass/plant roots)
- Soil layers at different depths (topsoil, subsoil, clay)
- Probe body (vertical rod with sensor nodes at depths)
- `HeatGradient` across soil layers — intensity from `moisture` value
  - Custom steps: `['#d4a574', '#a3865a', '#6b9ecc', '#3b82f6']` (dry tan → wet blue)
- Root zone indicator
- Labels: "SOIL PROBE", depth markers

- [ ] **Step 2: Register in TemplateRenderer + resolveTemplate**

Keywords: `['soil', 'soil_moisture', 'agriculture', 'agri', 'crop', 'field']`

- [ ] **Step 3: Verify TypeScript compiles and commit**

```bash
git add web/src/components/DeviceTemplates/templates/SoilProbeTemplate.tsx web/src/components/DeviceTemplates/TemplateRenderer.tsx web/src/components/DeviceTemplates/resolveTemplate.ts
git commit -m "feat(viz): add SoilProbeTemplate with moisture HeatGradient"
```

---

## Task 24: FuelTankTemplate (Tier 2)

**Files:**
- Create: `web/src/components/DeviceTemplates/templates/FuelTankTemplate.tsx`
- Modify: `web/src/components/DeviceTemplates/TemplateRenderer.tsx`
- Modify: `web/src/components/DeviceTemplates/resolveTemplate.ts`

- [ ] **Step 1: Create FuelTankTemplate**

SVG design: Horizontal/vertical fuel tank with fittings. 500×400 viewBox.

Similar structure to WaterTankTemplate but with fuel colors (amber/orange):
- Tank body (larger, horizontal cylinder or rectangular)
- `WaveLevel` — intensity from `fuel_level`, color `#f59e0b`
- `DashFlow` on outlet pipe — intensity from `consumption_rate`
- Fuel gauge markings (F/E or percentage)
- Fill cap on top
- Labels: "FUEL TANK"

- [ ] **Step 2: Register in TemplateRenderer + resolveTemplate**

Keywords: `['fuel', 'fuel_tank', 'diesel', 'petrol', 'gasoline', 'oil_tank']`

- [ ] **Step 3: Verify TypeScript compiles and commit**

```bash
git add web/src/components/DeviceTemplates/templates/FuelTankTemplate.tsx web/src/components/DeviceTemplates/TemplateRenderer.tsx web/src/components/DeviceTemplates/resolveTemplate.ts
git commit -m "feat(viz): add FuelTankTemplate with amber WaveLevel and DashFlow"
```

---

## Task 25: IrrigationTemplate (Tier 2)

**Files:**
- Create: `web/src/components/DeviceTemplates/templates/IrrigationTemplate.tsx`
- Modify: `web/src/components/DeviceTemplates/TemplateRenderer.tsx`
- Modify: `web/src/components/DeviceTemplates/resolveTemplate.ts`

- [ ] **Step 1: Create IrrigationTemplate**

SVG design: Irrigation controller with pipe network and spray zones. 500×400 viewBox.

- Controller box (top, with display)
- Main pipe running horizontally
- Branch pipes to 3-4 zones
- `DashFlow` on main pipe — intensity from `flow_rate`
- `PulseRing` on each zone — active/inactive based on `zone_active` telemetry
- Sprinkler head icons at each zone
- Labels: "CONTROLLER", "ZONE 1", "ZONE 2", etc.

- [ ] **Step 2: Register in TemplateRenderer + resolveTemplate**

Keywords: `['irrigation', 'sprinkler', 'drip', 'fertigation', 'pivot', 'zone_controller']`

- [ ] **Step 3: Verify TypeScript compiles and commit**

```bash
git add web/src/components/DeviceTemplates/templates/IrrigationTemplate.tsx web/src/components/DeviceTemplates/TemplateRenderer.tsx web/src/components/DeviceTemplates/resolveTemplate.ts
git commit -m "feat(viz): add IrrigationTemplate with DashFlow and zone PulseRings"
```

---

## Task 26: Final TypeScript Check + Fix TEMPLATE_MAP/TEMPLATE_CROPS

**Files:**
- Modify: `web/src/components/DeviceTemplates/TemplateRenderer.tsx`

At this point, `TEMPLATE_MAP` and `TEMPLATE_CROPS` must have entries for all 14 template names (since `TemplateName` was extended in Task 17). If any were missed during individual template tasks, add them now.

- [ ] **Step 1: Verify all templates are registered**

Check that `TEMPLATE_MAP` has all 14 entries and `TEMPLATE_CROPS` has all 14 entries.

- [ ] **Step 2: Run full TypeScript check**

Run: `cd web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: Zero errors.

- [ ] **Step 3: Commit any fixes**

```bash
git add web/src/components/DeviceTemplates/TemplateRenderer.tsx
git commit -m "fix(viz): ensure all 14 templates registered in TEMPLATE_MAP and TEMPLATE_CROPS"
```

---

## Task 27: Final Integration Verification

- [ ] **Step 1: Run dev server**

Run: `cd web && npm run dev`

Verify no console errors, templates render, and animations play when telemetry data is present.

- [ ] **Step 2: Visual check of offline state**

Temporarily set `deviceStatus="offline"` in DeviceVisualization and verify:
- Greyscale filter applies
- OfflineBadge renders centered
- All animations are paused

- [ ] **Step 3: Final commit if any tweaks needed**

```bash
git add -A
git commit -m "fix(viz): final animation system integration adjustments"
```

---

## Future: Intersection Observer (Performance Optimization)

> Not part of this plan — track as follow-up. Only needed if performance issues arise with 12+ animated devices.

Add an Intersection Observer in `TemplateRenderer` that sets `animation-play-state: paused` on templates scrolled out of view. This prevents offscreen CSS animations from consuming GPU cycles. The current implementation works well for 8-12 devices; this optimization is insurance for larger dashboards.
