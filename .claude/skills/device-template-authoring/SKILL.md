---
name: device-template-authoring
description: Use when adding or modifying a device illustration template (digital twin visual) in web/src/components/DeviceTemplates — new asset types like valve, conveyor, crusher, motor, substation, or reworking an existing template's artwork, slots, or animations.
---

# Device Template Authoring

Templates are data-driven SVG digital twins: artwork + motion driven by live
telemetry, with values etched into declared display slots. TypeScript's
`Record<TemplateName, …>` maps force you to every registration point — follow
the compiler. What the compiler can NOT check is how it looks: **you are not
done until you have looked at screenshots of all three bench states.**

## Files to touch (compiler enforces most)

| File | What |
|---|---|
| `templates/<Name>Template.tsx` | New component + `export const slots` |
| `types.ts` | Add to `TemplateName` union — unlocks the rest |
| `TemplateRenderer.tsx` | `TEMPLATE_MAP` entry + `TEMPLATE_CROPS` crop |
| `resolveTemplate.ts` | `CATEGORY_MAP` keywords + `BUILDER_SPECS` slot/status bindings |
| `app/dev/templates/page.tsx` | Bench fixture (schema + realistic telemetry) |

## Template contract

- `'use client'`; export `function <Name>Template({ telemetry, deviceStatus }: TemplateProps)` returning a `<g>`; viewBox is 500×400, crop trims empty vertical space — everything you draw must sit inside your crop window.
- `paused = deviceStatus === 'offline'` stops ALL motion.
- Resolve metrics with `resolveNumeric(telemetry, *_KEYS)` from `primitives/resolveNumeric.ts`; normalize to 0–1 intensity. Never hardcode values.
- Slots: regions where a real device shows values (gauge face, panel, register). Declare in SVG coords (`x,y` = text center, `width` = max text width). Draw a clean glass/plate under each slot; renderer etches smoothed SVG text there. No display on the real device (e.g. pump)? `slots = {}` — values go to the side grid. Boolean state → `status` binding in `BUILDER_SPECS` (corner pill), not a slot.

## Design language (keep the family resemblance)

- One light source top-left. `useMaterials()` + `MetalBody` (housings/pipes-lying-down get `horizontal`), `GlassFace` (always-dark instrument glass; light strokes `#94a3b8`–`#e2e8f0` on it, never theme vars), `AOShadow` under every body.
- `DashFlow` IS the pipe — casing, liquid, glow core, particles. Never draw pipe rects under it.
- Motion primitives: `Spinner` (rotors), `WaveLevel` (liquid), `ArcSweep` (needle dials), `Blink` (LEDs), `useSmoothed` (custom interpolation). Only SMIL (`<animate>`, `<animateMotion>`) or existing keyframes: `dash-flow-fwd`, `template-spin`, `pulse-ring-expand`, `blink-led`. New global CSS is a design-system change — don't.
- One accent per template (water `#38bdf8`, pump `#22d3ee`, energy `#f59e0b`, battery `#34d399`, air `#2dd4bf`, or a new one that fits); neutrals from theme vars.
- 2–4 realism details (flange bolts, vent slots, etched `GITO XX-000` label), not 20. ~220 lines max.

## Visual QA — mandatory, typecheck is not enough

1. `docker exec gito-web npx tsc --noEmit` → clean.
2. Open `http://localhost:3000/dev/templates`, screenshot, and LOOK at it:
   - **Online**: proportions, family resemblance, slot values legible and inside their plates, nothing clipped by the crop.
   - **Zero-activity toggle**: no motion, artwork still reads as a device.
   - **Offline toggle**: greys out, OFFLINE badge visible, values frozen.
3. Slot fit: temporarily set the fixture to max-length values (e.g. `100.0`, `15,433`) — text must shrink to fit, not spill.
4. Both themes if you touched colors outside the conventions above.
