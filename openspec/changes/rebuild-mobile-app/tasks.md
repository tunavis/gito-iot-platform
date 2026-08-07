# Tasks

**Who does what.** Tasks marked **[Mark]** are maintainer tasks — repo settings,
dependency choices, and anything outside `mobile/`. Everything else is **[Mike]**,
and none of it opens a file outside `mobile/`. If a task seems to require editing
`api/`, `web/`, `processor/`, `shared/`, or `db/`, that is the signal to stop and
raise it — not to widen the task.

**One task per sitting, in order.** Tick the box when it works on a real phone.
Then commit, push, and open a PR.

## 0. Make the repository safe to share (maintainer, before Mike clones)

The point of this group is that after it, **Mike cannot break the platform even
if he tries.** Not "is unlikely to" — cannot. Do all of it before he has access.

- [ ] 0.1 **[Mark]** Protect `main` on GitHub: require a pull request, block
      direct pushes, block force-push, block deletion. This single setting is
      what makes every later safety claim true — a branch is invisible to `main`
      until you merge it, so the worst outcome of a bad mobile commit is a PR you
      decline. Note the branch is named `main`, not `master`.
- [x] 0.2 **[Mark]** Add `.github/CODEOWNERS` assigning `/api/`, `/web/`,
      `/processor/`, `/shared/`, `/db/`, and `/openspec/specs/` to yourself, and
      enable "require review from Code Owners". This is the backstop for the one
      failure mode nothing else catches: an AI session on Mike's branch wandering
      outside `mobile/`. It cannot merge without you approving that specific file.
      — *File written. Two things still needed: enable the "require review from
      Code Owners" setting (the file is advisory without it), and confirm
      `@tunavis` is your actual GitHub username — a username that does not exist
      matches nobody and fails open.*
      *Corrected after a first pass: the `*` default line matched **everything**,
      including `mobile/` and this file. The closing comment claimed mobile had no
      code-owner entry; it did. Worse, it made Mike's own `tasks.md` require your
      approval to tick a box — while line 10 tells him to tick and PR after every
      task. `/mobile/` and `/openspec/changes/rebuild-mobile-app/` are now
      explicit **unowned** entries (a pattern with no owner clears ownership) and
      sit last in the file, because GitHub takes the last matching pattern. This
      removes a redundant gate, not the review: branch protection still requires
      one approval on every PR and nobody can approve their own.*
- [ ] 0.3 **[Mark]** Add Mike as a collaborator with push access to branches
      only. He never needs more; 0.1 makes `main` unreachable regardless.
- [x] 0.4 **[Mark]** Add a script that writes `openapi.json` from the FastAPI app
      itself (import the app, call `app.openapi()` — no running server), and
      commit the output. This is the contract Mike's types are generated from.
      — *`scripts/generate_openapi.py` + `openapi.json` (109 paths). It stubs the
      three settings that have no default so the import does not abort, and
      serialises with `sort_keys=True` — without a stable key order `--check`
      would fail on noise and everyone would learn to ignore it.*
- [x] 0.5 **[Mark]** Add a CI check that fails a PR which changed a router
      without regenerating `openapi.json`. Without this the committed schema
      silently rots and Mike's types are confidently wrong — the exact failure
      the generated-types design exists to prevent. — *`openapi-schema-current`
      job runs `--check` and gates `deployment-ready`. It needs no database. The
      thing that makes it trustworthy rather than flaky: `api/pyproject.toml`
      pins `fastapi==0.141.1` and `pydantic==2.13.4` exactly, so the runner
      serialises the schema byte-identically to the container. Verified today —
      the committed file matches what `gito-api` generates.*
- [x] 0.6 **[Mark]** Confirm CI runs on pull requests from Mike's branches, so
      his work is machine-checked before it reaches your review. — *Verified:
      `production-checks.yml` triggers on `pull_request` to `main`, so a mobile PR
      gets mock-data detection, lint, and the backend test suite. The mock-data
      job is worth noting — it enforces a spec requirement automatically.*
- [ ] 0.7 **[Mark]** Add a `mobile-checks` job to CI running `npm run check`
      inside `mobile/`. Gap found while verifying 0.6: `production-checks.yml`'s
      `frontend-lint` job targets `web/` only, so **nothing currently type-checks
      `mobile/` on a pull request**. Mike's local `npm run check` is the only gate
      until this exists, which makes the whole generated-types guarantee depend on
      him remembering to run it.

## 1. Prerequisites (maintainer)

- [x] 1.1 **[Mark]** Remove `mobile/` from `.gitignore` (the two lines
      `# Flutter mobile app (separate repo)` and `mobile/`). The previous app
      vanished because it was never tracked; this is the fix for that, and it
      must happen before any mobile file is committed or the whole directory
      stays invisible to git. — *Verified with `git check-ignore`: `mobile/` is no
      longer ignored and shows as untracked, so it will be committed.*
- [ ] 1.2 **[Mark]** Confirm 0.1–0.3 actually took effect by trying to push a
      throwaway commit directly to `main` yourself. It must be rejected. An
      unverified branch protection is the same as none.
- [x] 1.3 **[Mark]** Confirm Mike's own stack is the development target — his
      PC runs `api`, `postgres`, `processor`, and `mosquitto` from this repo's
      compose file with seeded data. He does **not** point at the homelab or at
      your machine: he needs to be able to acknowledge alarms and delete devices
      freely, and a shared environment makes that destructive and makes both of
      you unsure who changed what. `.env.example` therefore points at his own
      `localhost` API, and no task in this change ever needs your network.
      — *Confirmed. Two defects in that path found while checking it — both
      would have cost him a day and both would have looked like his own fault:*
      - *`docker-compose.yml`'s `command:` **replaced** the image's
        `entrypoint.sh`, so `alembic upgrade head` never ran in the dev stack.
        The loop in `ONBOARDING.md` ("restart and you're on Mark's latest
        schema") was therefore false: pull a migration, restart, and the API
        keeps serving the old schema — an application bug for however long it
        takes to suspect the database. Compose now runs migrations then uvicorn
        `--reload`. Verified: `alembic upgrade head` exits 0 in `gito-api`.*
      - *`scripts/seed_realistic_data.py` hardcoded `localhost:5432`, but
        compose maps postgres to **5433**. On a clean machine — with no WSL
        Postgres to accidentally answer — `seed_database.bat` dies on connection
        refused at step two of onboarding. Now `5433`, with a
        `SEED_DATABASE_URL` override so it also works from inside a container.
        Verified both DSNs: 5433 connects (68 devices), 5432 refuses. Same
        defect class as the simulator's `72033a6`, never swept across
        `scripts/`.*
- [x] 1.4 **[Mark]** Confirm a test login exists for Mike with a role that can
      read devices, dashboards, and alarms. Do not give him the
      `claude-playwright@gito.demo` account — dashboards are user-scoped, so he
      needs his own or he will see an empty dashboards list and think the app is
      broken. — *No new account needed: `db/init.sql` creates
      `admin@gito.co.za` / `Admin123!` when the database is first built, and it
      is **his own database** — so it is already a private login and the
      user-scoping problem that rules out the Playwright account does not arise.
      Now named directly in `ONBOARDING.md` instead of "the credentials Mark
      gives you", which was a round-trip for something already committed in
      `db/init.sql`. It exists **before** seeding — the seed adds devices, not
      users. His dashboards list starts empty, which is correct; the doc now
      tells him to create one in the web app so mobile has something to show.*
- [x] 1.5 **[Mark]** Write `mobile/CLAUDE.md`: the API contract (single objects
      returned directly, lists wrapped in `{data, meta}`), the token/tenant
      pattern, no hardcoded values, no mock data, never edit outside `mobile/`,
      and the widget config contract. Every AI session started inside `mobile/`
      reads this automatically, so it is how the guardrails hold when nobody is
      watching. It must exist before Mike's first session, not after.
- [x] 1.6 **[Mark]** Write `mobile/ONBOARDING.md` (Windows): install steps, how to
      start the app, the branch → task → check → PR loop, how to read `tasks.md`,
      and what to do when something looks like a platform bug (report it, never
      work around it). Task 2.2 sends Mike here first, so this is a prerequisite
      and not a deliverable of his. — *Written against the real ports (API 8001,
      web 3001, health 8088) rather than the tutorial defaults, and it names
      `scripts/seed_database.bat` — which is why Python is on his install list.*

## 2. Mike's PC

- [ ] 2.1 **[Mike]** Install Git, Node LTS, Docker Desktop, and Claude Code.
      Clone the repo. Nothing else — no Android Studio, no Xcode, no Flutter SDK.
- [ ] 2.2 **[Mike]** Read `mobile/ONBOARDING.md` end to end before writing
      anything. It is short, and it covers the workflow, the branch/PR loop, and
      what is off limits.
- [ ] 2.3 **[Mike]** Bring up your own platform stack from this repo's compose
      file and seed it. This is *your* copy — your API, your database, your demo
      devices. Nothing you do here touches anything Mark cares about, so you can
      acknowledge every alarm and delete every device and then re-seed.
- [ ] 2.4 **[Mike]** Confirm `http://localhost:8000/api/health` (or the port your
      compose file maps) returns healthy, and log into the web app on your own
      stack. If this fails, **stop here** — every later task will fail in a
      confusing way for this one reason, and no amount of mobile code will fix it.
- [ ] 2.5 **[Mike]** Install **Expo Go** from the App Store or Play Store on the
      phone you will test on, and confirm your phone and PC are on the same
      Wi-Fi. Expo serves over the LAN; different networks is the single most
      common reason "it won't connect".
- [ ] 2.6 **[Mike]** Learn the one rhythm that keeps you in sync with Mark's work
      on the web app and API. Before **every** task, not once a week:
      ```
      git checkout main && git pull        # get Mark's latest
      git checkout -b mobile/<task>        # your own branch
      npm run check                        # does his change affect you?
      ```
      If `npm run check` fails right after a pull, that is Mark's change reaching
      you, and the failures are exactly the list of what to fix. That is the
      system working, not something being broken.

## 3. Scaffold

- [ ] 3.1 Create the Expo app in `mobile/` with the TypeScript template and
      `expo-router`. Confirm the stock app loads in Expo Go on your phone before
      changing a single line — this proves the whole toolchain before any of our
      code can be blamed.
- [ ] 3.2 Add the folder structure from `design.md` as empty directories with a
      one-line README each: `app/`, `src/api/`, `src/auth/`, `src/theme/`,
      `src/ui/`, `src/widgets/`, `src/lib/`.
- [ ] 3.3 Add `app.config.ts` reading `EXPO_PUBLIC_API_BASE_URL` and
      `EXPO_PUBLIC_WS_BASE_URL` from env. Commit `.env.example` with the host
      from task 1.3; add `.env` to `mobile/.gitignore`. **No host string in any
      source file** — this is a spec requirement, not a preference.
- [ ] 3.4 Add `npm run check` = `tsc --noEmit` + `eslint`. It must pass on the
      empty scaffold. This is the command you run before every commit.
- [ ] 3.5 Re-read `mobile/CLAUDE.md` (written in 1.5) now that the scaffold is
      real, and correct anything it asserts that the scaffold contradicts — a
      guardrail file that describes a structure you did not build is worse than
      none, because every later AI session trusts it.

## 4. The API layer — do this before any screen

- [ ] 4.1 Add `openapi-typescript` and a `npm run api:types` script that reads the
      **committed** `openapi.json` at the repo root (from task 0.4) and writes
      `src/api/schema.d.ts`. Run it and commit the result. **Never hand-edit that
      file.** Read from the committed file, not from a running server — a server
      reflects whatever containers you have up, so an older migration state
      produces stale types that look authoritative and that nobody can tell apart
      from correct ones. The committed schema is tied to the commit, so pulling
      `main` is what makes your types right.
- [ ] 4.2 Write `src/api/client.ts`: a typed fetch wrapper over the generated
      types that attaches `Authorization: Bearer <token>`, resolves the base URL
      from config, and maps non-2xx to a typed error. No component ever calls
      `fetch` directly after this exists.
- [ ] 4.3 Add the 401 path: a rejected token clears secure storage and returns the
      user to login. Without this, an expired token produces an app that retries
      forever against a dead credential.
- [ ] 4.4 Add `@tanstack/react-query` and its provider in `app/_layout.tsx`.
- [ ] 4.5 Add the drift check: a script that regenerates `schema.d.ts` from the
      committed `openapi.json` and fails on a non-empty diff, wired into
      `npm run check`. This is what turns one of Mark's API changes into a
      failure you cannot miss rather than a bug a user finds.
- [ ] 4.6 Add ESLint rules forbidding `fetch(` outside `src/api/` and raw hex
      colour literals outside `src/theme/`. Two spec requirements become
      machine-checked instead of review-by-eye.

## 5. Auth

- [ ] 5.1 `src/auth/storage.ts` — token read/write/clear via `expo-secure-store`.
      Not `AsyncStorage`; the spec is explicit and this is a real security
      property, not a style choice.
- [ ] 5.2 `src/auth/jwt.ts` — decode `tenant_id`, `user_id`, `role` from the
      stored token. Add a Jest test with a known token fixture (a real decode has
      branches; this is worth the one test).
- [ ] 5.3 Auth context + `useAuth`, exposing `initialising` / `authenticated` /
      `unauthenticated` as three distinct states. Two states is the bug the
      Flutter app's spec called out — a loading state read as unauthenticated
      bounces the user to login on every cold start.
- [ ] 5.4 Login screen against the existing auth endpoint. Handle a wrong password
      as a visible error, not a silent no-op.
- [ ] 5.5 Route guard in `app/_layout.tsx`: hold while initialising, redirect only
      on resolved-unauthenticated, and send an authenticated user off the login
      route.
- [ ] 5.6 Verify on the phone: log in, force-close the app, reopen → still logged
      in. Then log out → back to login. This is the whole auth requirement,
      demonstrated.

## 6. Design system — before screens, so screens have nothing to invent

- [ ] 6.1 `src/theme/tokens.ts` — colour, glass materials, gradients, spacing,
      radii, typography, and motion springs, as typed exports. Dark-mode-first.
      Every value the app uses lives here.
- [ ] 6.2 `src/ui/GlassCard.tsx` using `expo-blur` against the native material.
      One component; every floating surface in the app is this.
- [ ] 6.3 `usePressAnimation` (Reanimated spring from a motion token) and
      `src/lib/haptics.ts` (one wrapper over `expo-haptics`). Every pressable in
      the app uses both, so feel is uniform and tunable in one place.
- [ ] 6.4 `src/ui/states.tsx` — `Loading`, `Empty`, `ErrorState` (with retry).
      Every data screen uses these three. This is the requirement that keeps
      vibe-coded screens from rotting into blank surfaces.
- [ ] 6.5 Honour the OS reduce-motion preference inside the shared primitives —
      once, here, not per screen.
- [ ] 6.6 Build one throwaway screen that shows a glass card, a gradient, a
      pressable with haptics, and all three states. Look at it on the phone in
      both light and dark. Tune the tokens until it feels right, then delete the
      screen. Getting the feel settled now is much cheaper than restyling nine
      screens later.

## 7. Devices

- [ ] 7.1 `src/api/hooks/devices.ts` — list and detail query hooks over the
      generated types. Remember the shapes differ: the list is
      `{data: [...], meta: {...}}`, the detail is the object directly.
- [ ] 7.2 Device list screen with `FlashList`, glass rows, and all three states
      wired. Read the total from `meta.total`, never from the returned array's
      length — that exact bug shipped in the web app (`ca6836f`) and reported 68
      devices as 50.
- [ ] 7.3 Pagination or infinite scroll — the API's `per_page` cap is 100 and the
      fleet is larger. A single unpaged request is the same defect again.
- [ ] 7.4 Search/filter on the device list, server-side via existing query params
      if they exist, client-side over loaded pages if not. Do not add an API
      parameter.
- [ ] 7.5 Device detail screen: metadata, current telemetry values, status. Units
      come from the device type's telemetry schema, never hardcoded.
- [ ] 7.6 Verify on the phone against real devices: counts match the web app
      exactly, and a device with no telemetry shows an empty state rather than
      blank space.

## 8. Live telemetry

- [ ] 8.1 `src/lib/deviceSocket.ts` — connect to `/api/v1/ws/devices/{id}` with
      the stored token. Return early with no connection if there is no token.
- [ ] 8.2 Bounded reconnect with backoff. Catch a failed upgrade inside the
      connect routine; an unhandled rejection here crashes the screen.
- [ ] 8.3 Polling fallback once the reconnect budget is spent, so the screen keeps
      updating instead of freezing on stale values while looking live.
- [ ] 8.4 Tear down on unmount — close the socket and clear any timer. Skipping
      this leaks a connection per visited device.
- [ ] 8.5 Wire it into device detail with a visible connection indicator, so
      "live" versus "polling" versus "disconnected" is legible to the user.
- [ ] 8.6 Verify on the phone: values update live; kill the API and the screen
      degrades honestly rather than silently; restart it and it recovers.

## 9. Alarms

- [ ] 9.1 `src/api/hooks/alarms.ts` — list, plus acknowledge and clear mutations
      against `POST .../alarms/{id}/acknowledge` and `.../clear`.
- [ ] 9.2 Alarm list screen, severity-styled from theme tokens, all three states.
- [ ] 9.3 Acknowledge and clear with a confirmation step and haptic feedback.
      Invalidate the query on success and render what the server returned — do
      not optimistically mutate a local copy, or mobile and web will disagree.
- [ ] 9.4 Handle a failed acknowledge: leave the alarm unacknowledged and surface
      the error. Showing a success that did not happen is worse than showing the
      failure.
- [ ] 9.5 Verify on the phone: acknowledge an alarm, then confirm it reads as
      acknowledged in the web app too.

## 10. Dashboards (read-only)

- [ ] 10.1 `src/api/hooks/dashboards.ts` — list and detail-with-widgets.
- [ ] 10.2 Dashboard list screen. Note dashboards are user-scoped, so this shows
      only your own — an empty list is correct, not a bug.
- [ ] 10.3 Widget renderer switch keyed on `widget_type`, reading `configuration`
      with the same keys the web widgets read. An unknown type renders an explicit
      placeholder **naming the type** — never a blank space, never skipped.
- [ ] 10.4 `kpi_card` — fully working, including trend if configured. Not a stub.
      Half-built widgets are what made the previous spec describe an incomplete
      app as if it were finished.
- [ ] 10.5 `gauge` — min/max/unit/thresholds from configuration.
- [ ] 10.6 `chart` — line/area/bar from real telemetry over the configured range.
- [ ] 10.7 `alarm_summary` — counts by severity from the summary endpoint.
- [ ] 10.8 Stop here on widget types. `map`, `table`, `status_matrix`,
      `pie_chart`, `scatter_plot`, `heatmap`, `stat_group`, and `device_info` fall
      to the placeholder from 10.3 and are a later change. The placeholder is the
      honest answer; a stub is not.
- [ ] 10.9 Verify on the phone: open a dashboard built in the web app and confirm
      the implemented widgets show the same values, and unimplemented ones say so
      by name.

## 11. Finish

- [ ] 11.1 `npm run check` clean: types, lint, and no schema drift.
- [ ] 11.2 Walk the whole app on a real phone in both light and dark mode. Every
      screen: loading, empty, and error states all reachable and all correct.
- [ ] 11.3 Grep your own work: no hex colours outside `src/theme/`, no hostnames
      outside config, no `fetch` outside `src/api/`, no `Math.random()`, no
      hardcoded device or tenant ids. If the lint rules from 4.6 are right this
      finds nothing — run it anyway.
- [ ] 11.4 Confirm no screen, tab, or nav entry exists for anything deferred in
      `design.md`. No "coming soon", no disabled buttons.
- [ ] 11.5 **[Mark]** Review against the spec's requirements, then merge.
- [ ] 11.6 **[Mark]** Update root `CLAUDE.md` with a mobile section, and
      `openspec/specs/architecture/spec.md`'s purpose line (it still says
      "a Flutter mobile app"). Then archive this change so the delta specs sync
      and the stale Flutter `mobile-app` spec is replaced.
