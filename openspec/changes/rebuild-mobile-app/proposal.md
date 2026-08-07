# Rebuild the mobile app as an Expo/React Native client

## Why

The `mobile/` directory has been deleted. It was never in git — `.gitignore` has
carried `mobile/` since the start with the note *"Flutter mobile app (separate
repo)"*, and that separate repo never happened. So the app existed on exactly one
laptop, unversioned, and is now gone. Nothing is recoverable and nothing is lost
that was reviewed.

What survives is `openspec/specs/mobile-app/spec.md`, which describes that
Flutter app as the platform's second client. Read honestly, it also documents why
starting over is the right call rather than a regression:

- `kpi_card` and `chart` were **stubs** with telemetry wiring incomplete.
- `map` and `table` widget types **did not exist**.
- Device visualization detected `gateway`/`tracker`/`actuator` categories and
  then fell through to the generic renderer for all three — the detection existed
  with no distinct treatment behind it.
- A dev-only `proxy.py` TCP relay shipped in the repo to work around the Android
  emulator's inability to reach a dockerised backend.

So the spec on disk describes a partial app, and it is the only artifact left.
Leaving it in `openspec/specs/` would leave the platform's spec set asserting a
Flutter client that does not exist, against version pins
(`openspec/specs/architecture/spec.md`) that are now fiction.

The second reason is who will build it. This app is to be developed primarily by
a **non-developer contributor working through AI assistance**, on Windows, and
the platform must not be reachable from his work. That constraint is not
incidental — it drives the stack choice, the enforcement mechanism for "no
hardcoded values", and the shape of `tasks.md`. A rebuild scoped by an OpenSpec
change is the leash: the task list never sends him into `api/` or `web/`, and
TypeScript against generated API types refuses to compile an invented endpoint.

## What Changes

**Stack: Expo (React Native) + TypeScript, replacing Flutter/Dart.**

Targets are iOS and Android only. Both stacks cover those equally well, so the
tiebreakers are the ones specific to this project:

- **One language across the repo.** Mobile in TypeScript is the same language as
  `web/`. One language to review, one for the contributor to learn, and shared
  types with the backend contract rather than a parallel hand-written set.
- **The contributor's iteration loop.** `npx expo start` plus Expo Go on a phone
  needs no Xcode, no Android Studio, and no native SDK. Flutter requires the
  Flutter SDK and a native toolchain before anything renders. `proxy.py` also
  stops being necessary — Expo serves over LAN.
- **AI writes better TypeScript/React than Dart/Flutter.** Since the code will be
  AI-authored, the quality of generated code is the quality of the app.
- **The requested design language maps to native materials.** Apple's Liquid
  Glass is built on `UIVisualEffectView`; `expo-blur` binds to that real system
  material. Flutter draws every pixel itself and must imitate it, and diverges
  whenever Apple changes it.
- **Hiring and continuity.** React/TypeScript developers outnumber Flutter
  developers substantially, and a React developer can contribute to `web/` and
  `mobile/` both.

**Zero hardcoded values is enforced by the type system, not by a rule.**
The API already publishes `/openapi.json`. Types are generated from it into
`mobile/src/api/schema.d.ts`, and every call goes through a typed client over
those types. An invented endpoint path or a misremembered field name fails to
compile. A response-shape change in `api/` breaks the mobile build instead of
silently breaking a screen. Base URL comes from config/env, JWT from
`expo-secure-store`, tenant id decoded from the token — never a literal.

**Phase 1 scope** (this change): authentication, device list and detail, live
telemetry, alarm acknowledge/clear, and dashboard viewing with the widget types
the web app supports. Commands, OTA, notifications, settings, and analytics are
deliberately deferred to a later change — a first change with a new contributor
needs a finish line, not the whole 30-router surface.

**Contributor guardrails ship with the app**: `mobile/CLAUDE.md` (inherited by
every AI session run inside `mobile/`) and `mobile/ONBOARDING.md` (Windows setup,
workflow, and what must never be touched).

**`mobile/` is removed from `.gitignore`** and version-controlled. The previous
app's disappearance is the direct consequence of it not being.

## Capabilities

- `mobile-app` (MODIFIED — every existing requirement is replaced; the Flutter
  app they describe no longer exists)
- `architecture` (MODIFIED — the mobile entry in the tech-stack requirement pins
  Flutter SDK and Dart package versions that no longer apply)

## Impact

- **Adds** `mobile/` as a version-controlled Expo TypeScript app.
- **Removes** `mobile/` from `.gitignore`.
- **Replaces** all six requirements in `openspec/specs/mobile-app/spec.md`.
- **Edits** the mobile clause of the tech-stack requirement in
  `openspec/specs/architecture/spec.md`.
- **No change to `api/`, `web/`, `processor/`, `shared/`, `db/`, or any
  migration.** The mobile app is a pure consumer of the existing API. If Phase 1
  finds that it needs an endpoint the API does not expose, that is its own
  change, proposed separately — not absorbed here.
- **Non-code prerequisite**: the contributor needs repository write access on a
  branch and a pull-request path to the maintainer. Nothing in this change lands
  on `main` without review.
