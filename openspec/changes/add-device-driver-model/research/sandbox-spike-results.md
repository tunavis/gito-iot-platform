# Sandbox spike results — phase 3, tasks 6.1 and 6.2

**Run 2026-08-03** on Windows 11, Python 3.12.5, node v24.18.0, `quickjs` 1.19.4,
`py-mini-racer` 0.6.0. Reproduce with
`python openspec/changes/add-device-driver-model/research/sandbox_spike.py`.

Limits applied: **500 ms wall clock, 32 MB memory** — a codec is a pure function
over ~50 bytes, so anything approaching either is pathological. Each attack runs
in a child process with a hard kill at 8× the runtime's own limit, because the
first thing being tested is whether a runtime can be made to ignore its own
ceiling; a test that hangs the harness has already answered the question.

## Results

| attack | quickjs | mini_racer (V8) | node subprocess |
|---|---|---|---|
| baseline honest codec | ok | ok | ok |
| infinite loop | contained | contained | **TIMEOUT** |
| memory bomb | contained | contained | **TIMEOUT** |
| recursion bomb | contained | contained | contained |
| `require('fs')` reachable | contained | contained | **REACHED_HOST** |
| read a real directory | contained | contained | **REACHED_HOST** |
| QuickJS `std.open` | contained | contained | contained |
| `fetch` | contained | contained | **REACHED_HOST** |
| `process.env` | contained | contained | **REACHED_HOST** |
| prototype pollution | IN_CONTEXT | IN_CONTEXT | IN_CONTEXT |
| `Function` constructor | IN_CONTEXT | IN_CONTEXT | IN_CONTEXT |

`contained` = the limit fired, or the capability was absent. `REACHED_HOST` = the
codec touched something outside the JS heap. `IN_CONTEXT` = it mutated its own
context or compiled more JS — see below, this is not the same thing.

All three compute the honest baseline codec identically (`4660`), so nothing
below is a capability trade.

## Conclusion: QuickJS, and it is not close

**`node` in a subprocess is disqualified.** It read `process.env` (returning this
machine's real environment), reached `fs` and listed a directory, and has
`fetch`. Neither the infinite loop nor the memory bomb was stopped by node
itself — `--max-old-space-size` bounds the heap but nothing bounds wall clock, so
both ran until the harness killed them. The task described node "under rlimits";
**Windows has no rlimits**, so that mitigation does not exist on the platform this
was measured on. It could be contained by an OS-level sandbox (container, seccomp,
job object), but that is a deployment apparatus, not a runtime property, and it is
exactly the kind of thing that is correct in the design document and absent in
production.

**QuickJS and mini_racer are both contained**, and QuickJS is the stronger of the
two on one specific piece of evidence: its **memory ceiling actually fired**
(`InternalError: out of memory`), whereas mini_racer's memory bomb was stopped by
the *timeout*, not by `max_memory`:

```
quickjs      memory_bomb   contained  JSException: InternalError: out of memory
mini_racer   memory_bomb   contained  JSTimeoutException: JavaScript was terminated by timeout
```

That distinction matters. A codec that allocates hard but returns inside 500 ms
is bounded by QuickJS and, on this evidence, unproven under mini_racer. QuickJS is
also far smaller, embeds without a V8 toolchain, and exposes no host bindings
unless you deliberately add them.

**Decision: QuickJS.** Task 6.2 is answered from measurement rather than from
documentation.

## The two findings that are constraints, not disqualifications

Both engines allow prototype pollution and both expose the `Function`
constructor. Neither is a host escape:

- `Object.prototype.polluted = 'yes'` mutates **that context's** heap. It matters
  only if a context is reused, which turns one tenant's codec into a booby trap
  for the next tenant's.
- `(function(){return this})().constructor.constructor('return 1+1')()` compiles
  new JavaScript. With no host bindings reachable, that is JS making more JS. It
  does mean **static analysis of codec source is worthless** — you cannot decide
  a codec is safe by reading it, only by running it inside a ceiling.

Both point at the same rule, which the design already states and this now
measures rather than assumes:

> one process per invocation or a pool that cannot carry state between tenants

**A fresh QuickJS context per invocation is therefore mandatory, not an
optimisation to defer.** Reusing one is the single change that would turn a
contained runtime into a cross-tenant vulnerability.

## What this spike does not establish

Honest limits on the evidence:

- **Measured on Windows only.** The processor runs in Linux containers. QuickJS's
  time and memory limits are library-level and should behave identically, but
  "should" is what this spike exists to replace — re-run it in the processor
  image before shipping phase 3.
- **No concurrency.** Every attack ran alone. Whether N simultaneous hostile
  codecs starve the processor's event loop is untested, and it is the failure
  mode most likely to matter in production.
- **No native-extension or bytecode attacks**, and no attempt at CPU-cache or
  timing side channels between contexts.
- **`filesystem_probe` originally read `/etc/passwd`** and reported node as
  contained, because that path does not exist on Windows — ENOENT, not a denial.
  Two other harness defects were found and fixed the same way (node's completion
  value was discarded so every probe read `undefined`; the absence convention was
  a hand-maintained list that mislabelled `'no fs'` as an escape). Three
  false readings in one spike is the argument for running the attacks rather than
  trusting a table — including this one.
