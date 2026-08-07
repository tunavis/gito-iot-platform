# Gito IoT — Mobile App (`mobile/`)

**Stack**: Expo (React Native) + TypeScript · iOS and Android only
**Role**: a second client against the same FastAPI backend as `web/`
**Spec**: `openspec/changes/rebuild-mobile-app/` — proposal, design, specs, tasks

This file governs every session run inside `mobile/`. The root `CLAUDE.md`
describes the platform and still applies; this file adds the rules specific to
building a client for it, and where the two disagree about mobile, this one wins.

---

## 🚫 The boundary — read this first

**You are working in `mobile/` only.** Do not create, edit, or delete files in
`api/`, `web/`, `processor/`, `shared/`, `db/`, `drivers/`, `scripts/`, or
`openspec/specs/`. Not to add an endpoint, not to widen a response, not to fix a
bug you noticed, not "just this once".

This is not a style preference. The mobile app is built by a contributor learning
as he goes, and the platform is live — 68 real devices, real tenants, a
processor ingesting real telemetry. A change to `api/` that looks small from here
can break ingestion for everyone.

**When mobile needs something the platform does not offer:**

1. Stop the task.
2. Write down exactly what is missing and which screen needs it.
3. Tell Mark. It becomes its own OpenSpec change against the API.

Do **not** work around it with a client-side hack, and do **not** widen the task
to include an API edit. A workaround that hides a platform gap is worse than the
gap, because the gap gets fixed and the workaround does not.

`.github/CODEOWNERS` enforces this — a pull request touching those paths cannot
merge without Mark's explicit approval. Treat that as a backstop, not a
permission slip.

---

## 🔌 The API contract

### Types are generated. Never hand-written.

`src/api/schema.d.ts` is generated from the repo's committed `openapi.json`
(itself generated from the FastAPI app). **Never edit `schema.d.ts` by hand** —
it is overwritten, and a hand-edit is a lie the compiler will believe.

```bash
npm run api:types     # regenerate from the committed openapi.json
```

If a field or endpoint you want is not in the generated types, **it does not
exist**. Do not add it to the types to make the code compile. That converts a
caught error into a runtime bug, which is precisely backwards.

### Response shapes differ by endpoint — this trips everyone

```typescript
// Single object — returned DIRECTLY, not wrapped
const device = await api.get("/tenants/{tenant_id}/devices/{device_id}", ...);
device.name                     // ✅

// List — wrapped in {data, meta}
const page = await api.get("/tenants/{tenant_id}/devices", ...);
page.data                       // ✅ the rows
page.meta.total                 // ✅ the fleet size
page.data.length                // ❌ NOT the fleet size — that's just this page
```

`page.data.length` as a total is a real bug that shipped in the web app: 68
devices reported as 50, because the API's default `per_page` is 50. **Always read
totals from `meta.total`.** `per_page` is capped at 100, so anything fleet-wide
must page.

### Never call `fetch` outside `src/api/`

Every request goes through the typed client, which attaches the bearer token,
resolves the base URL from config, and handles 401. ESLint enforces this.

---

## 🔑 Auth and tenancy

```typescript
// Token: expo-secure-store ONLY. Never AsyncStorage, never plain state.
// Tenant id: decoded from the token. NEVER hardcoded, never typed in by a user.
const { tenantId, userId, role } = useAuth();
```

Every tenant-scoped path takes `tenantId` from the decoded token. If you ever
find yourself pasting a UUID into source, stop — that is the bug this rule
exists to prevent, and it will work perfectly on your machine and for nobody else.

Auth has **three** states, not two: `initialising`, `authenticated`,
`unauthenticated`. Treating `initialising` as unauthenticated bounces the user to
login on every cold start — a documented bug in the previous mobile app.

---

## 🎨 Design system

The look is liquid glass, soft animated gradients, physics-based motion, floating
cards, dark-mode first, with haptics. It is built from libraries, not from scratch.

| Need | Use |
|---|---|
| Glass / frosted surfaces | `expo-blur` via `<GlassCard>` |
| Gradients | `expo-linear-gradient` |
| Mesh gradients, glow | `@shopify/react-native-skia` (only where a gradient can't) |
| Motion | `react-native-reanimated` + `moti` |
| Gestures | `react-native-gesture-handler` |
| Haptics | `expo-haptics` via `src/lib/haptics.ts` |
| Sheets / floating panels | `@gorhom/bottom-sheet` |
| Long lists | `@shopify/flash-list` |

**Every value comes from `src/theme/`.** No inline hex, no ad-hoc shadow, no
magic spacing number, no per-screen spring config. ESLint blocks hex literals
outside `src/theme/`.

Do not hand-roll an animation, a blur, or a press effect that a shared primitive
already provides. If a primitive is missing, add it to `src/ui/` once and use it
everywhere — do not solve it locally in a screen.

Reduce-motion is honoured inside the shared primitives. Do not re-check it per
screen.

---

## ❌ Absolutely not

- **No mock data.** No `Math.random()`, no hardcoded sample devices, no fake
  telemetry, no placeholder values standing in for real ones. CI has a
  mock-data detector that will fail your pull request.
- **No hardcoded hosts, ports, tenant ids, device ids, or UUIDs.** Hosts come
  from `app.config.ts` + env; ids come from the API or the token.
- **No stub screens.** If a capability is out of scope, it has **no** screen, no
  tab, no nav entry, no disabled button, no "coming soon". An honest absence beats
  a promise the app cannot keep. This is a spec requirement, not a preference.
- **No local persistence as a substitute for the API.** Reads may cache through
  React Query; writes require a connection. There is no offline write queue.
- **No second widget-config format.** Widgets read the same `configuration` keys
  the web app writes. A mobile-only field is a contract fork.

---

## ✅ In scope right now (Phase 1)

Auth · device list and detail · live telemetry · alarm acknowledge/clear ·
dashboard **viewing** (read-only).

Widgets implemented: `kpi_card`, `gauge`, `chart`, `alarm_summary`. Every other
`widget_type` renders an explicit placeholder **naming the type**.

**Deferred — build none of it, and show no entry point for it:** device commands,
OTA firmware, notifications, settings, users, analytics, hierarchy/sites, device
digital-twin visuals, dashboard editing.

---

## 🔄 Staying current with the platform

Mark works on `api/` and `web/` at the same time. You do not need to read a
changelog — pull, and let the compiler tell you:

```bash
git checkout main && git pull      # get Mark's latest
npm run check                      # tsc + lint + schema drift
```

If `npm run check` fails right after a pull, an API change has reached you and
the failures are the exact worklist. That is the system working correctly.

`openspec/specs/` is the current truth about platform behaviour, and it updates
when Mark archives a change. Read it rather than assuming.

---

## 🧭 Working method

One task from `openspec/changes/rebuild-mobile-app/tasks.md` at a time, in order.
Finish it, see it working on a real phone, run `npm run check`, tick the box,
commit, push, open a pull request.

Do not start the next task before the current one works. Do not batch several
tasks into one commit. Do not skip ahead to a more interesting task — the order
exists because later tasks assume earlier ones.

Before writing code for a task, say which task you are on. If a task seems to
require going outside `mobile/`, that is the signal to stop and ask — not to widen
the scope.
