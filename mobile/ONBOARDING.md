# Welcome, Mike — start here

You're building the Gito IoT mobile app. This document is the whole setup and the
whole workflow. Read it once before you write anything; it'll save you a day.

**The one thing to believe up front:** you cannot break the platform. Everything
you do happens on your own machine and on your own branch, and nothing reaches
the real system until Mark reviews and merges it. `main` is locked — even Mark
can't push straight to it. So experiment freely. The worst thing that can happen
is a pull request Mark declines, and that costs nothing.

---

## Part 1 — Install (once)

Install these four:

| | Why | Where |
|---|---|---|
| **Git** | version control | git-scm.com |
| **Node.js LTS** | runs the app tooling | nodejs.org — take the LTS build |
| **Docker Desktop** | runs your own copy of the platform | docker.com |
| **Python 3.11+** | needed once, to seed your database | python.org — **tick "Add Python to PATH"** |

Then **Claude Code** (Mark will point you at the install), and **Expo Go** on your
phone from the App Store or Play Store.

You do **not** need Android Studio, Xcode, or any phone SDK. If a guide tells you
to install one, you're reading the wrong guide.

Clone the repo:

```bash
git clone https://github.com/tunavis/gito-iot-platform.git
cd gito-iot-platform
```

---

## Part 2 — Your own platform (once)

You get a complete private copy of the platform: API, database, telemetry
processor, MQTT broker. It has demo devices and demo data. **It is entirely
yours** — nothing you do here is visible to Mark or to any real customer.

First, your settings file. `.env` is not in the repo (it holds secrets), so you
make your own from the example — from the **repo root**, not `mobile/`:

```bash
cp .env.example .env
```

Open it and replace the one value that has no working default:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Paste the output as `SECRET_ENCRYPTION_KEY=`. Every other value in the file
already works for local development — leave them alone. If you skip this step,
the stack starts but fails later in a way that won't point back here.

Now bring it up:

```bash
docker compose up -d
```

First run pulls images and builds; give it a few minutes. Then check it's alive:

```bash
curl http://localhost:8088/api/health
```

You want `healthy`. **If this doesn't work, stop and ask Mark — do not continue.**
Every later step depends on it, and they'll all fail in confusing ways that look
like your code's fault.

That one URL is the diagnostic for the whole stack; it names the layer that's
broken. Check it first, always, before reading any logs.

Seed demo data — device types, devices, and telemetry history:

```bash
cd scripts
seed_database.bat
cd ..
```

Now open **http://localhost:3001** and log in:

```
admin@gito.co.za
Admin123!
```

That account is created when your database is first built, so it works even
before you seed. It's a local development login on your own machine — not a
credential for anything real.

You should see devices. **You are now looking at your own platform** — click
anything, delete anything. If you wreck it, re-run the seed.

Your **dashboards list will be empty**, and that is correct, not a bug:
dashboards belong to the user who made them. Make one in the web app now — you'll
need it later to have something for the mobile app to display.

### Your ports

| Thing | URL |
|---|---|
| Health check (start here always) | http://localhost:8088/api/health |
| Web app | http://localhost:3001 |
| API directly | http://localhost:8001 |
| API docs (every endpoint, live) | http://localhost:8001/docs |

Note these aren't the defaults you'll see in tutorials — this project moves them
off 3000/8000/5432 so it can coexist with other stacks. Use the numbers above.

`http://localhost:8001/docs` is genuinely useful: it lists every endpoint and lets
you try them. When you're unsure what data exists, look there rather than guessing.

---

## Part 3 — How you work (every single task)

Your work is a numbered list: `openspec/changes/rebuild-mobile-app/tasks.md`.
Do them **in order**, **one at a time**. Tasks marked `[Mark]` aren't yours.

### The loop

```bash
# 1. Start from Mark's latest work
git checkout main
git pull

# 2. Bring your own stack up to his latest database schema.
#    Restarting is enough — the API container runs the migrations itself
#    on every start. Skip this and your app talks to last week's database.
docker compose up -d

# 3. Your own branch, named for the task
git checkout -b mobile/device-list

# 4. Does Mark's latest break anything of mine?
cd mobile
npm run check
```

Then open Claude Code and tell it which task you're doing. Be specific:

> Do task 7.2 from openspec/changes/rebuild-mobile-app/tasks.md. Only that task.

Then see it on your phone:

```bash
npx expo start
```

Scan the QR code with your phone's camera (iPhone) or the Expo Go app (Android).
The app loads on your phone and reloads as the code changes. **Your phone and your
PC must be on the same Wi-Fi** — different networks is the single most common
reason it won't connect.

When it works:

```bash
npm run check          # must pass — types, lint, schema drift
git add .
git commit -m "feat(mobile): device list screen"
git push -u origin mobile/device-list
```

Then open a pull request on GitHub and tell Mark. He reviews and merges.

Tick the task's box in `tasks.md` only when it actually works on your phone — not
when the code is written.

### Rules for the loop

- **One task per branch, one task per pull request.** Small changes get reviewed
  in minutes. Ten tasks in one pull request get reviewed next week.
- **Don't skip ahead.** Later tasks assume earlier ones exist.
- **Don't start the next task until the current one works.**
- **Pull `main` before every task**, not once a week. Small merges are easy;
  one big one after two weeks is not, and you won't enjoy resolving it.

---

## Part 4 — What's off limits

**You work in `mobile/` only.** Don't create or edit files in `api/`, `web/`,
`processor/`, `shared/`, `db/`, `drivers/`, `scripts/`, or `openspec/specs/`.

This isn't about trust. That code runs a live platform with real devices reporting
real data to real customers. A change there that looks tiny from the mobile side
can stop telemetry for everyone.

Claude will sometimes *offer* to edit those files — usually helpfully, because it
spotted a real problem. **Say no.** Then tell Mark what it found; a genuine
platform bug is valuable, and it becomes its own piece of work.

GitHub also blocks it: a pull request touching those paths can't merge without
Mark's explicit approval. Consider that a seatbelt, not permission.

### When something's missing from the API

You'll hit this. A screen needs a value the API doesn't return.

**Do:** stop, write down what's missing and which screen needs it, tell Mark.

**Don't:** invent it, hardcode it, fake it, or edit the API. A fake value looks
fine on your phone and is wrong for every real user — and it's the one class of
bug nobody catches in review, because it looks like it works.

---

## Part 5 — Things that will confuse you (they're normal)

**"My dashboards list is empty."** Dashboards are per-user. You only see your own.
Create one in the web app first, then it'll appear on mobile.

**"`npm run check` fails and I didn't change anything."** You pulled Mark's latest
and he changed the API. The failures list exactly what to fix. This is the safety
net working — you found it at build time instead of a user finding it later.

**"Types say a field doesn't exist but I'm sure it does."** Then it doesn't. The
types come from the API's own schema. Don't add it to the types to make the error
go away — that hides a real problem. Check http://localhost:8001/docs.

**"Expo won't connect to my phone."** Same Wi-Fi? Windows Firewall may also prompt
the first time — allow it.

**"Docker is using all my RAM."** It wants around 8GB. `docker compose down` when
you're done for the day; `docker compose up -d` next morning. Your data survives.

**"I broke my database."** Good — that's what it's for. Re-run `seed_database.bat`.

---

## Part 6 — Getting help well

When you're stuck, send Mark:

1. What task you're on.
2. What you expected.
3. What happened, with the **exact** error text — copy it, don't describe it.
4. What `curl http://localhost:8088/api/health` says.

That last one matters more than it looks. Half of all "the app is broken" turns
out to be a stack that isn't running, and it takes two seconds to rule out.

**Never guess at a fix you don't understand.** Asking costs a message. A confident
wrong fix costs a day, usually Mark's.

---

## The short version

```
git pull  →  docker compose up -d  →  branch  →  one task
          →  see it on your phone  →  npm run check
          →  commit  →  push  →  pull request
```

Stay in `mobile/`. No fake data, ever. Ask when unsure. You can't break anything.
