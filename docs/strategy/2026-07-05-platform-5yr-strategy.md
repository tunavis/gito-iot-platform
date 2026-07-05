# Gito Industrial Intelligence Platform — 5-Year Strategy (2026–2031)

**Status:** v2 — revised after 6-agent adversarial review (68 findings, 33 high-severity, all web-verified or repo-verified)
**Author:** Claude (with Mark Marais) — 2026-07-05
**Scope:** Platform architecture, module catalogue, AI agent ecosystem, roadmap, revenue model

**v2 changelog (what the review reversed):** conversational AI over live OT data and MCP exposure are
now *table stakes*, not differentiators (AWS SiteWise Assistant, AVEVA AI Assistant GA, Maximo watsonx,
Litmus & ThingsBoard MCP servers all ship today); the competitive section is rewritten around the real
regional competitors (IoT.nxt/Vodacom, ThingsBoard) instead of only enterprise giants; the processor's
forked alarm engine is now a named P0 prerequisite; the asset-registry effort was re-scoped (additive-only
in Y1); OPC-UA library switched to gopcua over LGPL asyncua; ISO 27001 now precedes SOC 2; IEC 62443-4-1
practices start now (certification is not retrofittable); self-serve is dropped as a Y1 motion (SA mining/
municipal procurement reality); Y1-H1 was halved and serialized; paid POCs/services/NRE/grants added as
the actual Y1 revenue; capacity assumptions corrected to demonstrated cadence.

---

## 1. Executive Summary — The Thesis (revised)

Gito today is a working multi-tenant IoT monitoring SaaS (FastAPI + Next.js + PostgreSQL/TimescaleDB +
Redis streams) with real shipped substance: schema-driven device types, a data-driven SVG digital-twin
system with a template-authoring pipeline, LoRaWAN/ChirpStack + MQTT ingestion, and an alarm engine.

The macro bet stands: **AI agents become a primary interface to industrial operations software.** But the
review killed the comfortable version of it — the incumbents are NOT asleep: AWS, AVEVA, IBM, Seeq and
even open-source ThingsBoard already ship conversational assistants and/or MCP surfaces. Being "AI-first"
is not the moat. The defensible position is narrower and must be executed precisely:

> **Answers grounded to the tag/alarm/timestamp level, over an edge-to-cloud data path we own, packaged
> for mid-market Southern African mining/water/energy operators, at a price and deployment reality
> (on-prem-capable, B-BBEE-compliant, integrator-friendly) that neither hyperscalers nor free
> open-source-plus-integrator stacks actually deliver.**

Strategic sequence: **own the data path (edge + connectivity) → make it intelligible (twins + knowledge)
→ make it conversational with citations (agents) → make it autonomous (graduated closed-loop) → package
it modularly (industry packs, then marketplace).**

Governing rules:
1. **Modular monolith, not microservices** — but honestly: the module contract does not exist yet in code
   and is budgeted as real Y1 work (§4), not assumed.
2. **Every feature is also an API + MCP tool.** MCP is catch-up, not moat — Litmus ships an MCP server
   today, Ignition's module is in Early Access, ThingsBoard has 120+ MCP tools. Our version competes on
   *governance*: typed tools, tenant scoping, approval gates, full audit.
3. **Buy/wrap before build** for non-differentiators. The differentiator is the grounded intelligence
   layer + the wedge-market fit, not protocol parsing.

---

## 2. Where We Stand (honest current state)

| Capability | State |
|---|---|
| Multi-tenant SaaS (RLS isolation, JWT, RBAC roles) | ✅ Shipped |
| Device types w/ telemetry schemas, KV telemetry store (Timescale) | ✅ Shipped |
| LoRaWAN: ChirpStack MQTT bridge (multi-tenant workers), TTN webhook, universal webhook | ✅ Shipped |
| MQTT ingest + processor (Redis streams, dedup, rate limits, twin cache) | ✅ Shipped |
| Alarms: threshold + composite rules, email notifications | ⚠️ Shipped but **forked**: processor has its own threshold-only AlertEvaluator + copy-pasted EmailService, separate from the API's unified engine — alarm behavior diverges by ingest path (verified: processor/mqtt_processor.py:607, :452, :102) |
| Dashboards + widgets, WebSocket live updates | ✅ Shipped |
| Digital twins: 8 data-driven SVG assets, display-slot contract, authoring skill | ✅ Shipped |
| Device RPC commands, firmware fields, solution templates | ✅ Shipped |
| Mobile app (Flutter) | 🟡 Early, unmaintained |
| OPC-UA / Modbus / S7 / BACnet / DNP3 drivers; edge gateway; AI features; billing; SSO/MFA; compliance posture | ❌ None |

**Capacity honesty (review finding):** repo history shows a 10-week commit gap (Apr→Jul 2026); demonstrated
cadence is one founder, part-time, with heavy AI-agent leverage. Every plan below is sized to that reality
— the plan states explicitly where hiring or committed hours would change it.

---

## 3. Competitive Landscape & Our Wedge (rewritten)

### 3a. Who the wedge customer actually cross-shops (the fight that matters)

| Competitor | Reality | How we beat them |
|---|---|---|
| **IoT.nxt (Vodacom)** | Pretoria-based, mining-focused, Raptor edge + platform, bundled with Vodacom connectivity | They sell telco bundles; we sell operational intelligence — grounded AI answers, twins, domain packs. Win on product depth + speed + not being locked to one carrier |
| **ThingsBoard** | Open-source; cloud from ~$49/mo; what price-sensitive SA integrators actually deploy; even ships an MCP server | "Free" costs integrator hours forever. We win on: industry packs that work day-1, twins without custom dev, cited AI answers, edge fleet management, local compliance/support. We must be *better assembled*, not cheaper than free |
| **Cumulocity / telco offerings** | Named in our own CLAUDE.md as competition | Same as above — generic platform vs assembled domain product |
| **Adroit / local SCADA + integrators** | Incumbent brownfield mindshare | Coexist: we ride Sparkplug/OPC-UA alongside SCADA, add the intelligence layer SCADA lacks |
| **TPG-owned ThingWorx + Kepware** | PTC divested both to TPG (completed 2026-03-16) — may re-emerge leaner and mid-market-focused, with Kepware's driver arsenal | Watch closely; their driver portfolio is the §7 moat we don't have yet. Speed + regional fit are the answer |

### 3b. Enterprise reference points (what "good" looks like, not who we out-price)

- **AWS IoT SiteWise Assistant** (GA Nov 2024): chat over live asset data + manuals in dashboards.
- **AVEVA Industrial AI Assistant** (GA Jul 2025, all CONNECT users): RAG over live streams/assets/MES.
- **IBM Maximo 9.1 watsonx assistant**: NL queries over live EAM data. **C3 AI**: citations-to-source is
  their headline claim. **Seeq**: mid-market pricing (~$1.2k/yr entry, AWS Marketplace self-serve) with
  bundled AI assistants — a real mid-market AI-analytics competitor, not enterprise-only.
- **Ignition**: unlimited-license SCADA king, now with Cloud Edition and an MCP module in EA.

**Consequence (review-forced):** "conversational operations" and "MCP-native" are NOT differentiators.
What remains defensible: (a) **citation granularity** — answers grounded to specific tags/alarms/timestamps
(enterprise assistants cite documents and asset summaries; none cite to the tag level at mid-market price);
(b) **the assembled wedge product** — edge + packs + twins + agents + compliance, sold as one thing a mine
can deploy without an integrator army; (c) **speed** — a 12–18 month feature lead is real but perishable;
every quarter of delay burns it.

**Market signal to respect:** PTC *exiting* horizontal IIoT platforms says undifferentiated platforms are
a bad business. We are not building a platform; we are building an assembled product for a wedge, on a
platform.

---

## 4. Target Architecture — Modular Monolith → Platform (corrected)

Architecture diagram unchanged from v1 in shape (clients → modular core → ingest plane → data plane →
edge), with three review-forced corrections:

**4a. P0 prerequisite — unify the alarm engine (NEW, before anything else).** The processor contains a
forked, threshold-only alarm evaluator with its own SQL and a copy-pasted email service; composite rules
live only API-side. Every future alarm feature (asset scoping, hysteresis, insight events) would be built
twice or silently diverge. Fix: single alarm-evaluation service consumed by both paths (in-process lib or
API-side evaluation triggered off the stream). Effort M. **This precedes the asset registry** — it is the
real "clean seam" work.

**4b. Asset Registry — additive-only in Y1 (re-scoped).** v1 called this "Effort M"; verified fan-out says
otherwise: 231 device_id references across 16 routers, two alarm engines, strictly per-device twins.
Y1 scope: `assets` table + hierarchy + device→asset attachment + asset-scoped *reads* (grouping, rollups,
MCP tools). Alarms/twins stay device-scoped through Y1; re-keying them is Y2 work, scheduled, not smuggled.
Multi-device asset twins (a conveyor = drives + idlers + belt) are therefore Y2 — which moves the conveyor
pack to H2+ (§5).

**4c. Module contract — build it, don't assume it (corrected).** Verified: no event bus exists in code;
29 routers with a partial service layer. Y1 work item ("module contract enforcement", effort M): in-process
domain events (typed, versioned) mirrored to Redis streams; data-ownership rules per module; import-boundary
lint. Without this the "extraction seams" claim is fiction.

---

## 5. Module Catalogue (sequencing corrected)

A module = versioned pack of `device types + twin templates + alarm-rule packs + report templates +
dashboards + agent playbooks (+ optional drivers)`, installed per-tenant, gated by licensing. The shipped
solution-template system is the seed.

| Module | Y1 reality check | Priority |
|---|---|---|
| Core Platform (alarm unification, asset registry additive, module contract, audit) | The actual Y1-H1 backbone | P0 |
| Connectivity + Edge | Modbus TCP first; OPC-UA H2 (gopcua); Sparkplug B H2 as *boundary interop only* | P0 |
| **Mining Ops** | **H1 = pump-station pack only** (reuses shipped Pump/WaterTank twins + existing alarm engine). Conveyor pack needs multi-device twins (Y2) AND cross-metric correlation (F4) — belt-slip in H1 was fiction. Dust/ventilation/tailings: H2+ with domain-expert validation; tailings monitoring is regulated (GISTM) — partner, don't improvise | P0 wedge |
| Water Utilities | H2: reservoir/pump-station/pressure packs on shipped twins; night-flow leak detection needs F4 | P1 |
| Energy | Y2: metering, solar (shipped twin), gensets; load forecasting after F4 | P1 |
| Manufacturing OEE | Y2-Y3, after references | P2 |
| Camera/CV (wrap models) | Y2+ | P2 |
| Agriculture / Smart Buildings | opportunistic, reseller-pulled | P3 |

---

## 6. The AI Platform (revised)

Agents are thin; the platform is thick. Frontier-hosted LLMs first. Per-tenant token metering from day one.

**Agent-runtime decision (review-forced):** Claude Agent SDK has the deepest MCP support but owns the loop
and is Anthropic-tuned — that conflicts with the Y3 air-gapped commitment. Resolution: agent loop goes
behind **our own thin runtime interface from day one** (trigger → context assembly → tool loop → artifact
output). Claude SDK is the first implementation; an air-gapped/self-hosted implementation can replace it
per-deployment without rewriting agents. Accepted trade-off: cloud agents are better for years; air-gapped
customers get a reduced agent set when SLM quality allows.

### 6.1 Foundations (re-sequenced)

| # | Foundation | Change from v1 |
|---|---|---|
| F0 | **Unified alarm engine** | NEW — prerequisite (see §4a) |
| F1 | **Gito MCP Server** — typed tools, tenant-scoped, approval-gated, audited; pin MCP spec version, track Linux-Foundation evolution | Reframed: table stakes executed better, not "a product in itself" — ThingsBoard gives its MCP away free |
| F2 | **NLQ** (templated text→SQL plans, cited) | Confirmed by review as right approach; moves to H2 |
| F3 | **Knowledge Base** (pgvector RAG, citations mandatory) | Confirmed; H2 |
| F4-lite | **Statistical insights** — flatline/stuck-sensor, rate-of-change, EWMA bands | Pulled INTO H1 (cheap, runs in unified alarm engine) so the first assistant can honestly answer "abnormal behaviour" questions |
| F4 | Seasonal decomposition, learned per-metric baselines, correlation mining | H2-Y2 |
| F5 | **Agent runtime** (own interface; Claude SDK impl; artifact-based collaboration; full tool-call audit — audit ships WITH the first agent, not later) | Y1-H2 |

### 6.2 Agents (sequencing corrected)

**H1 ships an internal-facing MCP demo, not a public assistant beta.** The public Operations Assistant
ships H2 on F1+F2+F4-lite and is scoped honestly: lookups, charts, alarm summaries, anomaly *flags* —
causal "why did production drop" answers arrive with F3/F4 in Y2. Never demo what the foundations can't
ground; a wrong cited answer at a mine is the trust incident §13 warns about.

Sequence after that (unchanged in order, shifted right ~6 months): Reporting Agent → Maintenance Engineer
(RUL claims stay modest: runtime-hours + trend heuristics are maintenance *prioritization*, not "RUL" —
marketing must match math) → Data Analyst → Safety/Environmental → Reliability → Compliance → PLC Engineer
(read-only forever by default).

### 6.3 AI Digital Twin
Predicted-state rendering (ghost needle + forecast scrub) on the shipped slot system. Review verdict:
differentiation *uncertain but plausible* — no verified competitor does lightweight web twins with
predicted state at mid-market; treat as strong feature, not guaranteed moat. Y2.

### 6.4 Edge AI (date corrected)
Review: scoped SLM inference is viable NOW (Phi-4-mini/Gemma-3-4B class; Pi AI HAT+ 2, $130, 40 TOPS).
Revised: **Y2, not Y3** — scoped edge tasks first (alarm summarization, NLQ intent parsing, offline shift
briefs) behind the same runtime interface. Full conversational edge agents remain later. This matters
because offline-AI in air-gapped mining is our own wedge story — conceding it to 2029 was self-harm.

---

## 7. Connectivity & Edge (corrections applied)

**Gito Edge Gateway** stays the second product and the moat-builder: driver host + local rules +
store-and-forward (SQLite WAL) + fleet agent + claim-code onboarding + X.509 mTLS. H1 alpha = **Modbus TCP
only**, one real site. OTA strategy needs A/B partition or supervised rollback, not bare container-tag
pulls (review: bricked remote mining gateways are a truck roll).

**Driver sequence with licensing verified:**
1. **Modbus TCP** — pymodbus (BSD-3 ✅). H1.
2. **OPC-UA** — **gopcua (MIT, Go)**, NOT asyncua: asyncua is LGPL-3.0 whose anti-tivoization terms
   conflict with signed/locked gateway images. H2.
3. **Sparkplug B** — *boundary interop driver only* (consume/publish for Ignition-centric plants).
   v1's "internal normalization layer" claim was wrong: SpB is MQTT-only, flat-model, stateful-alias,
   4-level-topic — it cannot express our hierarchy. **The Gito event schema is the normalization layer.** H2.
4. **Modbus RTU/serial** — H2/Y2. 5. **Siemens S7** — python-snap7 is MIT and pure-Python since v3.0
   (v1's "licensing check" was moot); can move earlier if a customer pulls it. 6. BACnet/DNP3/IEC-61850 —
   partner/customer-funded only.

**Ingest scaling:** v1's "10–50k msg/s, years of runway" was unverified folklore. Replace with: benchmark
the real pipeline at 10× current load in H2 (one day of work), publish the number internally, and key the
Kafka/partitioning trigger to *measured* headroom, not vibes.

---

## 8. Security & Compliance (resequenced for the wedge)

| Step | When | Correction |
|---|---|---|
| **IEC 62443-4-1 lightweight SDL practices** (threat model, security requirements, test evidence, patch process) | **Start now** | Certification is NOT retrofittable — 4-2 component cert requires development-time 4-1 process evidence. Also corrected: zones/conduits are 62443-**3-2** system concepts; the gateway is a *component at a zone boundary*; SL2 is a full requirement set (identification, audit storage, software integrity, session control), not just "no inbound ports" |
| MFA (TOTP) + session hardening | H2 | moved from H1 (capacity) |
| OIDC SSO → SAML | Y2 | enterprise door-opener |
| Secrets mgmt + edge PKI/cert rotation | with edge **alpha** (H1, minimal) → hardened at GA | earlier than v1 for the PKI seed |
| **ISO 27001** | **Y2 — before SOC 2** | Reversed from v1: ISO is what SA/Africa mining, municipal and energy procurement recognizes; SOC 2 is a US attestation our wedge rarely requests. SOC 2 follows when international expansion demands (controls overlap; use compliance-automation tooling for both) |
| Deployment models | SaaS → single-tenant VPC (Y2) → on-prem lite (Y3, reduced agent set per §6) | unchanged |

---

## 9. Revenue Architecture (grounded in Y1 cash reality)

**What actually pays the bills in Y1 (v1 omitted all of these):**
- **Paid POCs** (R150k–R400k, 8–12 weeks, scoped success criteria) — the OT-standard sales vehicle.
- **Site survey / commissioning / integration services** — priced properly, not given away.
- **Customer-funded NRE** for drivers/features (the DNP3 pattern, §7) as an explicit stream.
- **Non-dilutive funding workstream:** IDC, TIA, Mandela Mining Precinct programs, mining-house innovation
  funds, DBSA/DFI water programs. For a bootstrapped team this is material and was absent from v1.
- Consequence: **SOW/invoicing tooling before Stripe.** Card-swipe self-serve is a Y4+ international
  motion; SA mining/municipal buyers procure via vendor registration, B-BBEE scorecards, MHSA §37(2)
  agreements and MFMA tenders. Build the **vendor-onboarding pack** (tax clearance, BEE cert, safety file,
  insurance) — that is the real conversion bottleneck, and it's paperwork, not code.

**Subscription model (corrected):** per-asset pricing is the segment *norm* (ThingsBoard per-device,
Samsara per-asset), not a disruption. Our packaging: **site license wrapper** — fixed annual fee per site
with asset-tier bands inside (procurement-friendly, budgetable, cap-respecting), unlimited users/dashboards
always. **Define "asset" contractually now** (a nameable piece of equipment with ≤N devices and fair-use
metric density) before billing exists — a gameable unit inverts unit economics. Anti-per-tag positioning
survives as marketing against legacy contracts; it is not the business model's magic.

**Channel (corrected):** one motion in Y1 — **direct lighthouse**. The SI/white-label channel is
anti-aligned with claim-code/self-serve UX (it deletes their billable hours); before any pilot, design SI
economics deliberately (services-led certified-partner program, deal registration, 30–40% services attach)
— Y2 at earliest. AI tier, module licensing, marketplace rev-share: unchanged from v1 but all Y2+.

**Commercial skeleton (v1 had zero numbers — placeholder targets, founder to confirm):**
Y1: 1–2 paid POCs converting to 1 lighthouse ARR ~R300–600k + services/NRE ≥ R500k.
Y2: 4–6 sites, ARR R2–4m, break-even on run-rate. Y3: 15+ sites via 2–3 certified SIs, ARR R8–15m.
These are falsifiable gates, not vibes; wrong numbers get corrected by contact with the market.

---

## 10. Five-Year Roadmap (halved, serialized, gated)

**Rule (review-forced):** max 3 concurrent workstreams; 25–30% of capacity reserved for run/maintain
(the shipped surface already demands it: bridge follow-ups, alert-preview TODO, Flutter app debt).
If capacity stays at demonstrated part-time cadence, stretch every phase ×2 — or hire.

**Y1-H1 — "One honest wedge" (serial critical path):**
1. Unify alarm engine (F0) → 2. Asset registry *additive* → 3. MCP server (F1) + F4-lite statistical
insights → 4. Mining pump-station pack (shipped twins) → 5. Edge alpha (Modbus TCP, one real site) →
6. **One** lighthouse — precondition: signed LOI/paid POC *before* the build list is committed.
Dropped from H1 (vs v1): NLQ, public assistant beta, MFA, billing skeleton, OPC-UA, conveyor/dust packs,
2nd/3rd lighthouse.

**Y1-H2 — "Grounded assistant":** NLQ (F2) + KB (F3) → Operations Assistant public (honest scope per §6.2)
→ Reporting Agent → OPC-UA (gopcua) + Sparkplug interop → MFA → ingest benchmark → Water pack v1 →
ISO 27001 groundwork. Gate to enter H2: lighthouse live 30 days streaming real data; <3 critical bugs/mo;
POC pipeline ≥2.

**Y2 — "AI operations, proven":** agent runtime (F5) + Maintenance + Data Analyst agents → full F4 →
multi-device asset twins + predicted-state twins → conveyor/dust packs → scoped edge AI (SLM) → ISO 27001
cert → single-tenant VPC → S7 driver → SI partner program design → billing automation.

**Y3 — "Ecosystem, carefully":** marketplace infra (first-party packs as installable units first) →
Safety/Compliance agents → on-prem lite (reduced agents) → CV module (wrapped) → Manufacturing/OEE →
certified-SI channel live → SOC 2 if international pipeline demands.

**Y4–Y5 — "Autonomy + expansion":** graduated autonomy (recommend → approve-to-act → bounded auto-act,
insurance-grade audit) → cross-tenant benchmarking (privacy-preserving) → international mid-market via
partners → third-party marketplace → edge conversational agents if SLM economics land.

---

## 11. Differentiators (pruned by review — the survivors)

1. **Tag-level cited answers at mid-market price** — enterprise assistants cite documents/summaries;
   grounding to specific tags/alarms/timestamps, self-servable by an SMB mine, remains open space. This is
   the positioning claim we can defend in a bake-off — "they don't cite" is NOT (C3 cites; never say it).
2. **Predicted-state web twins** (uncertain-but-plausible whitespace) — live + forecast ghost state,
   authored in hours via the template skill, no 3D consulting project.
3. **Agent-authored asset packs** — new equipment manual PDF → drafted device type + twin + alarm pack +
   report template; human approves. Marketplace content at AI speed.
4. **The assembled wedge product** — edge + packs + twins + cited agents + SA compliance pack, one vendor,
   deployable without an integrator army. Neither hyperscalers nor free-OSS-plus-hours delivers this.
5. **Claim-code commissioning** — genuinely great UX; a feature, not a moat (and it must be reconciled
   with SI channel economics before Y2).
6. **Shift-handover briefs** — the *category* exists (eschbach SAMI, Hexagon j5); our version wins on
   zero-setup (auto-generated from data already in Gito) and mid-market price. Retention feature.
7. **Graduated autonomy with audit-grade guardrails** — the Y4 bridge from monitoring to operating.

Removed by review: "MCP-native platform" (table stakes), "conversational operations" (shipped by five
incumbents), "per-asset pricing as disruption" (segment norm — repackaged as site licenses, §9).

---

## 12. What We Deliberately Do NOT Do (additions in bold)

- No microservice rewrite; no Kafka before the *measured* trigger (§7).
- No 3D/Unity twins. No training foundation/CV models. No per-tag/per-seat pricing.
- No PLC write-access by AI without human approval gates — ever.
- **No public AI answers the foundations can't ground** — assistant scope grows with F-layers, never ahead.
- **No self-serve/card-billing motion before Y4** — the wedge procures via tender and POC.
- **No SI/white-label pilots before the channel economics are designed** (Y2).
- **No claiming competitors lack what they ship** — every competitive claim carries a source and a date.
- No horizontal platform marketing — wedge first, expand from references.

---

## 13. Risks (revised)

| Risk | Mitigation |
|---|---|
| **Capacity is 1 part-time founder, not 2 FTE** (repo evidence: 10 dark weeks) | Roadmap sized to it (§10 rule); explicit fork: commit hours / hire one engineer / stretch phases ×2. This is the #1 decision the founder must make |
| Incumbent AI ships faster than our wedge closes (AVEVA/AWS assistants improve quarterly) | 12–18mo window: H1/H2 dates are the strategy; every slip burns moat |
| ThingsBoard/IoT.nxt price pressure at the low end | never compete on price with free; compete on assembled product + compliance + cited intelligence |
| Lighthouse procurement stalls the plan (6–18mo mining cycles) | signed LOI precondition; POC-funded runway; H2 gate decoupled from deployment *count* |
| LLM COGS erode AI margin | metering day one; small-model routing; edge SLM offload (Y2) |
| AI trust incident | citations mandatory; honest scope (§6.2); incident playbook; approval gates |
| Alarm-engine fork ships new divergence before unification lands | F0 is workstream #1; freeze processor alarm features until unified |
| Key-person risk | this document, repo skills, and written decisions are the mitigation — keep them current |

---

*Review provenance: 6-agent adversarial panel (3 web fact-checkers, 3 repo-grounded skeptics), 68 findings
(33 high). Full findings JSON preserved in session transcript; every reversed claim above carries its
source in the findings record. Next actions: (1) founder decision on capacity fork (§13.1); (2) alarm-engine
unification design doc; (3) asset-registry additive schema; (4) lighthouse LOI pursuit before H1 commit.*
