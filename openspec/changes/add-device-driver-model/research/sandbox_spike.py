"""Phase 3, task 6.1 — run hostile codecs against each candidate runtime.

The point is to record **what actually happened**, not what the documentation
claims. A sandbox chosen from a README and not from an adversarial input is the
kind of decision that reads fine and fails under the first real attack, and in
this platform it would fail beside every tenant's data: RLS is inert under the
application's database role, so there is nothing underneath to contain a breach.

Run:  python sandbox_spike.py            # all candidates it can import
      python sandbox_spike.py --json     # machine-readable

Candidates:
  quickjs      — QuickJS via Python bindings (small, embeddable, no host bindings)
  mini_racer   — a V8 isolate
  node         — a short-lived subprocess

Each attack is run in a child process with a hard wall-clock kill, because the
first thing being tested is whether the runtime can be made to ignore its own
limits. A test that hangs the harness has answered the question.
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import subprocess
import sys
import tempfile
import time

# A codec is a pure function bytes -> JSON. Everything here is something a codec
# has no business doing; a runtime that permits any of them is disqualified for
# tenant-supplied code.
ATTACKS: dict[str, str] = {
    "baseline_honest_codec": """
        function decode(b) { return { volume: b[0] * 256 + b[1] }; }
        decode([0x12, 0x34]).volume;
    """,
    "infinite_loop": """
        while (true) {}
    """,
    "memory_bomb": """
        var a = []; for (;;) { a.push(new Array(1000000).join('x')); }
    """,
    "recursion_bomb": """
        function f(){ return f(); } f();
    """,
    # Reachability, not a specific path. An earlier version read /etc/passwd,
    # which fails with ENOENT on Windows — so node looked contained when
    # `require('fs')` had in fact succeeded. A probe that passes for the wrong
    # reason is worse than no probe.
    "filesystem_probe": """
        (typeof require === 'function' && typeof require('fs').readFileSync === 'function')
            ? 'fs reachable' : 'no fs';
    """,
    "filesystem_read_real_file": """
        require('fs').readdirSync('.').length > 0 ? 'listed cwd' : 'empty';
    """,
    "filesystem_probe_no_require": """
        (typeof std !== 'undefined' && std.open) ? 'std.open exists' : 'no std';
    """,
    "network_call": """
        (typeof fetch === 'function') ? 'fetch exists' : 'no fetch';
    """,
    "process_env": """
        (typeof process !== 'undefined') ? JSON.stringify(process.env).slice(0,40) : 'no process';
    """,
    "prototype_pollution": """
        Object.prototype.polluted = 'yes';
        ({}).polluted;
    """,
    "host_escape_constructor": """
        (function(){ return this; })().constructor.constructor('return 1+1')();
    """,
}

# A codec is a pure function over ~50 bytes. Anything near these is pathological.
WALL_CLOCK_MS = 500
MEMORY_MB = 32


# ── Runners ──────────────────────────────────────────────────────────────────
#
# Each returns (outcome, detail). `outcome` is one of:
#   contained  — the runtime stopped it, by limit or by absence of the capability
#   ESCAPED    — the attack succeeded; disqualifying
#   error      — the runtime raised something other than a limit (usually fine)
#   TIMEOUT    — the runtime did not honour its own limit; disqualifying


def run_quickjs(source: str) -> tuple[str, str]:
    import quickjs

    ctx = quickjs.Context()
    ctx.set_memory_limit(MEMORY_MB * 1024 * 1024)
    ctx.set_time_limit(WALL_CLOCK_MS / 1000)
    try:
        return "ok", repr(ctx.eval(source))[:120]
    except Exception as e:  # noqa: BLE001 - the outcome is the point
        return "contained", f"{type(e).__name__}: {str(e)[:110]}"


def run_mini_racer(source: str) -> tuple[str, str]:
    import py_mini_racer

    ctx = py_mini_racer.MiniRacer()
    try:
        return "ok", repr(ctx.eval(source, timeout=WALL_CLOCK_MS, max_memory=MEMORY_MB << 20))[:120]
    except Exception as e:  # noqa: BLE001
        return "contained", f"{type(e).__name__}: {str(e)[:110]}"


def run_node(source: str) -> tuple[str, str]:
    """`node` in a short-lived subprocess. No rlimits on Windows — that absence
    is itself a finding, and is recorded rather than worked around.

    The source is run through `eval` so its **completion value** is reported,
    exactly as `quickjs`/`mini_racer` `eval()` do. An earlier version wrapped it
    in a function with no `return`, so every node run printed `undefined` and
    every capability probe looked contained when it had simply not been read.
    Comparing runtimes on different notions of "the result" is worse than not
    comparing them.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
        fh.write(
            "const SRC = " + json.dumps(source) + ";\n"
            "let out; try { out = eval(SRC); } catch (e) { console.error(String(e)); process.exit(3); }\n"
            "console.log(typeof out === 'undefined' ? 'undefined' : String(out));\n"
        )
        path = fh.name
    try:
        p = subprocess.run(
            ["node", f"--max-old-space-size={MEMORY_MB}", path],
            capture_output=True, text=True, timeout=WALL_CLOCK_MS / 1000,
        )
        if p.returncode != 0:
            return "contained", f"exit {p.returncode}: {(p.stderr or '').strip()[:110]}"
        return "ok", (p.stdout or "").strip()[:120]
    except subprocess.TimeoutExpired:
        return "TIMEOUT", f"still running after {WALL_CLOCK_MS}ms — killed by the harness"
    finally:
        os.unlink(path)


RUNNERS = {"quickjs": run_quickjs, "mini_racer": run_mini_racer, "node": run_node}


# ── Harness ──────────────────────────────────────────────────────────────────


def _child(runner_name: str, source: str, q) -> None:
    try:
        q.put(RUNNERS[runner_name](source))
    except BaseException as e:  # noqa: BLE001 - MemoryError is not an Exception subclass in all paths
        q.put(("error", f"{type(e).__name__}: {str(e)[:110]}"))


def run_one(runner_name: str, attack: str, source: str) -> dict:
    """Run in a child process with a hard kill, so a runtime that ignores its own
    limit is recorded rather than hanging this script."""
    q = mp.Queue()
    p = mp.Process(target=_child, args=(runner_name, source, q))
    started = time.monotonic()
    p.start()
    # Generous: 8x the runtime's own limit. Anything hitting this ignored it.
    p.join(timeout=max(8 * WALL_CLOCK_MS / 1000, 6))
    elapsed_ms = int((time.monotonic() - started) * 1000)

    if p.is_alive():
        p.kill()
        p.join()
        return {"attack": attack, "runtime": runner_name, "outcome": "TIMEOUT",
                "detail": "ignored its own limit; killed by the harness", "ms": elapsed_ms}

    outcome, detail = q.get() if not q.empty() else ("error", "child produced no result")

    # Classify what "it returned a value" actually means. Three different things
    # get called an escape and only one of them disqualifies a runtime:
    #
    #   REACHED_HOST  — the codec touched something outside the JS heap. Fatal.
    #   IN_CONTEXT    — it mutated its own context (prototype pollution) or
    #                   compiled more JS. Harmless in a fresh context with no
    #                   host bindings; fatal only if contexts are reused across
    #                   tenants, which is a design constraint, not a runtime
    #                   verdict.
    #   contained     — the capability was absent, or a limit stopped it.
    #
    # Every probe reports absence as a string beginning "no " — a convention
    # rather than a list of expected answers, because a hand-maintained list is
    # one probe away from calling a contained runtime an escape, which is how a
    # spike talks you out of the right choice.
    if outcome == "ok" and attack != "baseline_honest_codec":
        stripped = detail.strip("'\"")
        if stripped.startswith("no ") or stripped in ("undefined", "None"):
            outcome = "contained"
        elif attack in ("prototype_pollution", "host_escape_constructor"):
            outcome = "IN_CONTEXT"
        else:
            outcome = "REACHED_HOST"

    return {"attack": attack, "runtime": runner_name, "outcome": outcome,
            "detail": detail, "ms": elapsed_ms}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    available = []
    for name in RUNNERS:
        if name == "node":
            try:
                subprocess.run(["node", "--version"], capture_output=True, timeout=10, check=True)
                available.append(name)
            except Exception:  # noqa: BLE001
                print(f"skipping {name}: not installed", file=sys.stderr)
            continue
        try:
            __import__("py_mini_racer" if name == "mini_racer" else name)
            available.append(name)
        except ImportError:
            print(f"skipping {name}: not installed", file=sys.stderr)

    results = [run_one(r, a, s) for a in ATTACKS for r, s in
               ((r, ATTACKS[a]) for r in available)]

    if args.json:
        print(json.dumps(results, indent=2))
        return 0

    width = max(len(a) for a in ATTACKS) + 2
    print(f"\nwall-clock limit {WALL_CLOCK_MS}ms, memory limit {MEMORY_MB}MB\n")
    print("attack".ljust(width) + "".join(r.ljust(26) for r in available))
    print("-" * (width + 26 * len(available)))
    for attack in ATTACKS:
        row = attack.ljust(width)
        for runtime in available:
            hit = next(x for x in results if x["attack"] == attack and x["runtime"] == runtime)
            row += f"{hit['outcome']} ({hit['ms']}ms)".ljust(26)
        print(row)

    escapes = [r for r in results if r["outcome"] in ("REACHED_HOST", "TIMEOUT")]
    print("\n--- detail ---")
    for r in results:
        print(f"{r['runtime']:<12} {r['attack']:<28} {r['outcome']:<10} {r['detail']}")

    print(f"\n{len(escapes)} escape(s)/timeout(s) across {len(results)} runs")
    return 0


if __name__ == "__main__":
    mp.freeze_support()
    sys.exit(main())
