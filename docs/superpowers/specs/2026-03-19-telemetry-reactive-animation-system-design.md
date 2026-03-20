# Telemetry-Reactive Animation System

**Date:** 2026-03-19
**Status:** Approved
**Platform:** Gito IoT Platform

---

## Problem

The platform's device visualization uses static SVG illustrations. Competitors (ThingsBoard, Cumulocity) offer generic widget dashboards but lack device-aware animated visuals. The current templates show no motion, no data-driven reactivity, and no visual distinction between online and offline states.

## Goal

Build a telemetry-reactive animation system where every device template behaves as a **digital twin** — animations are driven by real telemetry values (pump impellers spin at actual RPM, water levels reflect actual fill %, flow particles move at actual flow rate). This is the platform's competitive differentiator: device-aware animated visualizations that require zero configuration.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approach | Animated device illustrations (not generic widget canvas) | ThingsBoard already does widget canvas well. Device-aware visuals are the differentiator. |
| Animation style | Data-driven intensity | Animation speed/magnitude scales with telemetry values. The device "feels alive." |
| Offline behavior | Freeze + greyscale + OFFLINE badge | Clean, unambiguous. No ghost animations. |
| Performance target | 8-12 animated devices on screen | Covers site overview dashboards (full pump station, solar farm). |
| Animation technology | CSS animations + SVG | Zero-dependency, GPU-accelerated, trivially paused. Works with existing hand-coded SVG templates. |
| Architecture | Animation primitives library | Reusable components that templates compose. DRY, consistent, testable. |

---

## Architecture

### Animation Primitives

Eight CSS-animated SVG components sharing a common interface:

```typescript
interface AnimationPrimitiveProps {
  intensity: number;    // 0-1, maps telemetry to animation speed/magnitude
  paused: boolean;      // true when device offline → freeze + greyscale
  color: string;        // system color (water blue, energy amber, etc.)
}
```

**Intensity mapping:** Template receives raw telemetry (e.g., `rpm: 1450`), knows its range (e.g., 0-3000), normalizes to 0-1 (`intensity = 1450 / 3000 = 0.48`). Primitive animates at 48% speed/magnitude.

| Primitive | CSS Technique | Intensity Effect |
|-----------|--------------|-----------------|
| `Spinner` | `rotate` transform | Speed: 0.5s (max) → 4s (min). Dead zone: intensity < 0.05 = stopped. |
| `FlowParticles` | `stroke-dashoffset` animation | Dash speed scales linearly |
| `WaveLevel` | Animated `d` path + `clipPath` | Wave height = fill %, ripple speed = flow rate. Extracts existing wave code from WaterTankTemplate into reusable primitive. |
| `PulseRing` | `scale` + `opacity` keyframes | Pulse frequency scales with activity |
| `HeatGradient` | `stop-color` transition on SVG gradient | Discrete 4-step color (blue→green→amber→red) with CSS transitions between steps. Not continuous interpolation. |
| `ArcSweep` | `stroke-dashoffset` on arc path | Sweep position = value % |
| `Blink` | `opacity` keyframes | Blink rate = urgency level |
| `DashFlow` | `stroke-dashoffset` infinite scroll | Direction + speed from flow value |

All primitives accept `paused`. When true:
- `animation-play-state: paused`
- CSS filter: `grayscale(1) opacity(0.5)`
- Parent template renders an `OfflineBadge` overlay

### File Structure

```
web/src/components/DeviceTemplates/
├── primitives/
│   ├── Spinner.tsx
│   ├── FlowParticles.tsx
│   ├── WaveLevel.tsx
│   ├── PulseRing.tsx
│   ├── HeatGradient.tsx
│   ├── ArcSweep.tsx
│   ├── Blink.tsx
│   ├── DashFlow.tsx
│   └── index.ts
├── templates/
│   ├── WaterTankTemplate.tsx        (existing, enhanced)
│   ├── WaterMeterTemplate.tsx       (existing, enhanced)
│   ├── PumpTemplate.tsx             (existing, enhanced)
│   ├── GeneratorTemplate.tsx        (existing, enhanced)
│   ├── SolarTemplate.tsx            (existing, enhanced)
│   ├── HvacTemplate.tsx             (existing, enhanced)
│   ├── TempHumidityTemplate.tsx     (new — Tier 1)
│   ├── PowerMeterTemplate.tsx       (new — Tier 1)
│   ├── ValveTemplate.tsx            (new — Tier 1)
│   ├── GenericSensorTemplate.tsx    (new — Tier 1)
│   ├── BoreholeTemplate.tsx         (new — Tier 2)
│   ├── SoilProbeTemplate.tsx        (new — Tier 2)
│   ├── FuelTankTemplate.tsx         (new — Tier 2)
│   └── IrrigationTemplate.tsx       (new — Tier 2)
├── OfflineBadge.tsx
├── TemplateRenderer.tsx
└── resolveTemplate.ts
```

### Enhanced TemplateProps

```typescript
export interface TemplateProps {
  width: number;
  height: number;
  telemetry?: Record<string, number | string | null>;
  deviceStatus?: 'online' | 'offline' | 'unknown';
}
```

**Where `deviceStatus` comes from:** The parent `DeviceVisualization` component already has the device object (via `useDeviceMetrics`). The device has a `status` field (`online`/`offline`). `DeviceVisualization` passes it through `TemplateRenderer` → template. If status is unavailable, default to `'unknown'` (treated same as online — no greyscale, no badge).

### Integration Points for New Templates

When adding new templates, these files must all be updated:

1. **`types.ts`** — extend `TemplateName` union type with new names
2. **`TemplateRenderer.tsx`** — add to `TEMPLATE_MAP` (name → component) and `TEMPLATE_CROPS` (name → viewBox crop)
3. **`resolveTemplate.ts`** — add keyword mappings for auto-detection
4. All new templates use the same **500×400 base viewBox** convention

### Telemetry Key Resolution

Shared utility for fuzzy telemetry key matching. **Replaces** the existing `findLevelValue()` in WaterTankTemplate. The existing `findKey()` in resolveTemplate stays as-is — it returns key names for overlay binding, whereas `resolveNumeric()` returns resolved values for animation intensity. Different purposes, shared key lists.

```typescript
const FLOW_KEYS = ['flow_rate', 'flow', 'flowrate', 'water_flow', 'rate'];
const RPM_KEYS = ['rpm', 'speed', 'motor_speed', 'fan_speed', 'rotor_speed'];
const LEVEL_KEYS = ['tank_level', 'level', 'fill_level', 'volume_percent', 'fill', 'water_level'];
// ... per metric type

function resolveNumeric(
  telemetry: Record<string, number | string | null>,
  keys: string[],
  fallback = 0
): number {
  for (const k of keys) {
    const v = telemetry[k];
    if (v !== null && v !== undefined && !isNaN(Number(v))) return Number(v);
  }
  return fallback;
}
```

---

## Template Details

### Existing Templates (Enhanced)

Each existing template retains its current static SVG structure. Primitives layer on top of or replace the static elements they animate.

| Template | Primitives Used | Telemetry Keys → Intensity |
|----------|----------------|---------------------------|
| **WaterTank** | `WaveLevel`, `DashFlow` | `tank_level` → fill height; `flow_rate` → inlet/outlet dash speed |
| **WaterMeter** | `ArcSweep`, `DashFlow` | `flow_rate` → needle position; `flow_rate` → pipe dash speed |
| **Pump** | `Spinner`, `DashFlow`, `PulseRing` | `rpm` → impeller spin; `flow_rate` → pipe flow; `rpm > 0` → motor LED |
| **Generator** | `Spinner`, `Blink`, `DashFlow` | `rpm` → engine flywheel; `power > 0` → status LED; `fuel_rate` → fuel line |
| **Solar** | `HeatGradient`, `DashFlow`, `Blink` | `irradiance` → panel glow; `power` → DC/AC cable flow; `status` → inverter LED |
| **HVAC** | `Spinner`, `DashFlow`, `HeatGradient` | `fan_speed` → fan spin; `airflow` → duct flow; `supply_temp` → coil color |

### New Templates — Tier 1

| Template | Description | Primitives | Telemetry |
|----------|-------------|-----------|-----------|
| **TempHumidity** | Thermometer + humidity droplet | `HeatGradient`, `PulseRing` | `temperature` → thermometer gradient; `humidity` → condensation pulse rate |
| **PowerMeter** | Electrical panel with breakers + gauge | `DashFlow`, `ArcSweep`, `Blink` | `power` → cable flow; `load_percent` → gauge sweep; `alarm` → LED blink |
| **Valve** | Gate/ball valve with handle + pipe | `ArcSweep`, `DashFlow` | `position` → handle rotation; `flow_rate` → downstream flow (0 when closed) |
| **GenericSensor** | Universal sensor with signal rings | `PulseRing`, `Blink` | First non-status numeric telemetry key → pulse rate; `online` → heartbeat LED. Fallback for devices that don't match any specific template. |

### New Templates — Tier 2

| Template | Description | Primitives | Telemetry |
|----------|-------------|-----------|-----------|
| **Borehole** | Deep well cross-section with submersible pump | `WaveLevel`, `Spinner`, `DashFlow` | `water_table` → water level; `pump_rpm` → submersible pump; `flow` → riser pipe |
| **SoilProbe** | Soil layers cross-section with moisture gradient | `HeatGradient` | `moisture` → gradient (dry tan → wet blue) across soil layers |
| **FuelTank** | Diesel/petrol tank (amber variant of WaterTank) | `WaveLevel`, `DashFlow` | `fuel_level` → fill height (amber); `consumption_rate` → outlet flow |
| **Irrigation** | Pipe network with spray zones | `DashFlow`, `PulseRing` | `flow_rate` → pipe flow; `zone_active` → spray pulse per zone |

---

## Offline State

### OfflineBadge Component

Rendered by `TemplateRenderer` **after** the template SVG, positioned using the template's crop coordinates so the badge is always centered in the visible area regardless of viewBox cropping:

```tsx
function OfflineBadge({ crop }: { crop: { x: number; y: number; w: number; h: number } }) {
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
        style={{ fill: '#94a3b8', fontSize: 14, fontWeight: 600, fontFamily: 'system-ui' }}>
        OFFLINE
      </text>
    </g>
  );
}
```

### CSS Transition

```css
.device-template--offline {
  filter: grayscale(1) brightness(0.7);
  transition: filter 0.6s ease;
}
.device-template--online {
  filter: none;
  transition: filter 0.6s ease;
}
```

The 0.6s transition creates a smooth "wake up" effect when a device comes back online.

---

## Performance Strategy

For 8-12 animated devices on screen simultaneously:

1. **CSS animations only** — GPU-accelerated, no JS animation loops
2. **`will-change: transform`** on spinning elements only (not all primitives)
3. **Intersection Observer** — pause animations on off-screen templates (`animation-play-state: paused`)
4. **Throttled telemetry updates** — existing 30s refresh cycle, no change needed
5. **No `requestAnimationFrame`** — pure CSS means zero JS overhead per frame

6. **`prefers-reduced-motion`** — respect OS accessibility setting. When active, disable all animations (show static state at current telemetry values). Single CSS media query wrapping all primitives.
7. **SVG ID uniqueness** — primitives that use `clipPath` or `filter` IDs must generate unique IDs per instance via React `useId()` hook. Prevents collisions when multiple instances of the same template render on one page.

**Estimated cost:** ~8 CSS animations per template x 12 devices = ~96 concurrent CSS animations. Modern browsers handle 200+ easily on desktop. On mobile/tablet, the Intersection Observer mitigation keeps only visible devices animated. If performance issues arise on low-end tablets, fallback: reduce to primary primitive only per template.

---

## Color System

Consistent with existing FlowLine effects:

| System | Primary | Shadow | Highlight |
|--------|---------|--------|-----------|
| Water | `#3b82f6` | `#1d4ed8` | `#93c5fd` |
| Energy | `#f59e0b` | `#d97706` | `#fcd34d` |
| Air | `#22d3ee` | `#0891b2` | `#a5f3fc` |
| Gas | `#a3e635` | `#65a30d` | `#d9f99d` |
| Fuel | `#f97316` | `#c2410c` | `#fed7aa` |
| Heat (cold) | `#3b82f6` | — | — |
| Heat (warm) | `#f59e0b` | — | — |
| Heat (hot) | `#ef4444` | — | — |
| Soil (dry) | `#d4a574` | — | — |
| Soil (wet) | `#3b82f6` | — | — |

---

## Migration Strategy

Incremental — each template enhanced one at a time:

1. Build 8 animation primitives (standalone, testable)
2. Build `OfflineBadge` + offline CSS
3. Add `deviceStatus` to `TemplateProps` and `TemplateRenderer`
4. Enhance existing 6 templates (one PR per template)
5. Build Tier 1 new templates (4 templates)
6. Build Tier 2 new templates (4 templates)
7. Update `resolveTemplate.ts` to map new device categories

Each step is independently shippable. No big-bang migration.

---

## Scope Boundaries

**In scope:**
- 8 animation primitives
- 6 existing template enhancements
- 8 new device templates
- Offline state handling
- Telemetry key resolution utility
- Performance optimizations (Intersection Observer)

**Out of scope:**
- User-configurable animation settings
- Custom template builder
- 3D / WebGL visualizations
- Sound effects
- Template marketplace
