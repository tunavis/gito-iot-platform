# Gito Industrial Intelligence Platform — 5-Year Strategy (2026–2031)

**Status:** Draft v1 (solo synthesis; pending multi-agent adversarial review)
**Author:** Claude (with Mark Marais) — 2026-07-05
**Scope:** Full platform architecture, module catalogue, AI agent ecosystem, roadmap, revenue model

---

## 1. Executive Summary — The Thesis

Gito today is a working multi-tenant IoT monitoring SaaS (FastAPI + Next.js + PostgreSQL/TimescaleDB +
Redis streams) with genuine differentiators already shipped: schema-driven device types, a live
data-driven SVG digital-twin system, LoRaWAN/ChirpStack + MQTT ingestion, and an alarm engine.

The 5-year bet: **AI agents become the primary interface to industrial operations software.**
Dashboards become the fallback, not the front door. Incumbents (Siemens, AVEVA, PTC, IBM) carry
20 years of UI/architecture debt and sell through 18-month enterprise sales cycles. A small,
AI-native player wins by being *the platform an operations manager can talk to* — and by landing
in a regional wedge (Southern African mining, water utilities, energy) that the giants serve badly
and price out of reach.

Strategic sequence, one sentence: **own the data path (connectivity + edge) → make the data
intelligible (twins + knowledge base) → make it conversational (agents) → make it autonomous
(closed-loop automation) → sell it modularly (marketplace + white-label).**

Three rules that govern everything below:
1. **Modular monolith, not microservices.** A 2-dev + AI-agents team ships a modular monolith with
   clean module boundaries; we extract services only when a hot path proves it (ingest first).
2. **Every feature is also an API + MCP tool.** If an agent can't call it, it isn't done. The MCP
   server is a first-class product surface, not an integration afterthought.
3. **Buy/wrap before build** for anything that isn't the differentiator (drivers, CV models,
   automation engine). The differentiator is the intelligence layer, not protocol parsing.

---

## 2. Where We Stand (honest current state)

| Capability | State |
|---|---|
| Multi-tenant SaaS (RLS isolation, JWT, RBAC roles) | ✅ Shipped |
| Device types w/ telemetry schemas, KV telemetry store (Timescale) | ✅ Shipped |
| LoRaWAN: ChirpStack MQTT bridge (multi-tenant workers), TTN webhook, universal webhook | ✅ Shipped |
| MQTT ingest + processor (Redis streams, dedup, rate limits, digital-twin cache) | ✅ Shipped |
| Alarms: threshold + composite rules, notifications (email) | ✅ Shipped |
| Dashboards + widgets, WebSocket live updates | ✅ Shipped |
| Digital twins: 8 data-driven SVG assets w/ display-slot contract + authoring skill | ✅ Shipped |
| Device RPC commands, firmware fields, solution templates | ✅ Shipped |
| Mobile app (Flutter) | 🟡 Early |
| OPC-UA / Modbus / S7 / EtherNet-IP / BACnet / DNP3 drivers | ❌ None |
| Edge gateway product (offline buffering, fleet mgmt) | ❌ None |
| AI features (any) | ❌ None |
| Billing / licensing / marketplace | ❌ None |
| SSO/SAML, MFA, SOC2/ISO/IEC-62443 posture | ❌ None |

**Asset to protect:** the ingest→twin→alarm pipeline works end-to-end today and is architecturally
clean. **Debt to respect:** single-region, single Postgres, no billing — fine for now, planned for below.

---

## 3. Competitive Landscape & Our Wedge

*(Qualitative from training knowledge — verify volatile specifics in review pass.)*

| Player | Strength | Exploitable weakness |
|---|---|---|
| Ignition (Inductive) | Beloved unlimited-license model, SCADA-grade, huge integrator network | On-prem-first DNA; SaaS/AI bolted on; UI is engineer-only |
| Siemens Industrial Edge | Hardware reach, brand trust | Ecosystem lock-in, glacial, expensive |
| PTC ThingWorx | Enterprise features, twin pedigree | Notoriously heavy, costly, consultant-driven |
| AVEVA (PI) | The historian incumbent; data gravity | Pricing hostility is legendary; innovation slow |
| AWS IoT / Azure IoT Ops | Infinite scale primitives | Not products — toolkits; need an integrator; no domain UX |
| Litmus | Strong edge/driver story | Thin above the edge: analytics/UX shallow |
| C3 AI / Seeq | Analytics/AI narrative | Enterprise price floor ($M), services-heavy, no SMB motion |
| IBM Maximo | EAM/CMMS install base | Legacy weight; AI = add-on marketing |
| Tulip | Frontline apps UX | Manufacturing-only niche |

**Gaps nobody fills well:** (a) affordable, self-serve, AI-first platform for mid-market industrial
operators; (b) conversational operations over *live* OT data with citations back to tags/alarms;
(c) mining-specific SaaS (tailings, ventilation, dust, diesel) at non-enterprise pricing;
(d) genuinely good digital twins without a 3D/consulting project.

**Wedge:** Southern Africa mining + water + energy mid-market, priced per-asset (not per-tag),
self-serve onboarding, agents that speak the operation's language. Expand outward from reference
sites → white-label resellers (system integrators) → international mid-market.

**Packaging pattern to steal:** Ignition proved unlimited-tags licensing wins hearts. Our analog:
**unlimited metrics/users per asset** — price on monitored assets + AI tier, never per-tag, never per-seat.

---

## 4. Target Architecture — Modular Monolith → Platform

```
┌────────────────────────────  CLIENTS  ────────────────────────────┐
│  Next.js web · Flutter mobile · AI Chat/Voice · 3rd-party via API │
└──────────────────────────────┬────────────────────────────────────┘
                               │  REST / GraphQL(read) / WS / MCP
┌──────────────────────────────▼────────────────────────────────────┐
│                    GITO CORE (modular monolith)                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌────────────┐  │
│  │ Assets/ │ │ Telemetry│ │ Alarms/ │ │ AI Layer │ │ Billing/   │  │
│  │ Devices │ │ + Twins  │ │ Automa- │ │ (agents, │ │ Licensing/ │  │
│  │ /Fleet  │ │          │ │ tion    │ │ RAG, NLQ)│ │ Marketplace│  │
│  └─────────┘ └─────────┘ └─────────┘ └──────────┘ └────────────┘  │
│   Module contract: each = router + service + models + events +    │
│   MCP tools + (optional) UI package. In-process event bus now;    │
│   same events mirrored to Redis streams for external consumers.   │
└───────┬──────────────────────────────────────────────┬───────────┘
        │                                              │
┌───────▼───────────┐                        ┌─────────▼─────────┐
│ INGEST PLANE       │                        │ DATA PLANE        │
│ processor(s):      │                        │ Postgres (OLTP +  │
│ MQTT · ChirpStack  │                        │ RLS) · Timescale  │
│ bridges · webhooks │                        │ (telemetry) ·     │
│ · Sparkplug B ·    │                        │ pgvector (KB) ·   │
│ camera events      │                        │ Redis (streams,   │
└───────▲───────────┘                        │ cache, pubsub)    │
        │ store-and-forward                   └───────────────────┘
┌───────┴───────────────────────────────────────────────────────────┐
│ GITO EDGE (new product): drivers (Modbus/OPC-UA/S7/…) · local     │
│ rules · buffer · local twin cache · optional edge AI · fleet-     │
│ managed from cloud · same event schema as cloud ingest            │
└───────────────────────────────────────────────────────────────────┘
```

**Why monolith-first matters:** microservices would consume the whole team in plumbing. The module
contract (each module = router + service + event emissions + MCP tools) gives us extraction seams
for later without paying the distributed-systems tax now. The **first and only early extraction**
is the ingest plane (already a separate `processor` container — correct instinct, keep it).

**Asset Registry (P0 spine):** everything below hangs off a proper hierarchy —
`Tenant → Site → Area → Asset → Device → Metric`. We have sites/hierarchy + devices today; the gap
is formalizing **Asset** as the unit customers think in (a conveyor, a pump station) with devices
attached to assets, twins attached to assets, alarms/reports/agents scoped to assets. Effort: M.
This single refactor multiplies the value of every module after it.

---

## 5. Module Catalogue

**What an industry module IS technically** (this makes the marketplace real): a versioned pack of
`device-type definitions + twin templates + alarm-rule packs + report templates + dashboard layouts +
agent knowledge (domain prompts/playbooks) + optional drivers`. The solution-template system that
exists today is the seed of exactly this. Modules install per-tenant; licensing gates activation.

| Module | Contents (beyond core) | Priority | Effort | Why this order |
|---|---|---|---|---|
| **Core Platform** | asset registry, fleet, RBAC+, audit, API mgmt, billing | P0 | L | Everything depends on it |
| **Connectivity** | Modbus TCP→RTU, OPC-UA, S7, Sparkplug B, BACnet, DNP3 (sequenced) | P0 | XL (phased) | Data is the moat |
| **Mining Ops** | conveyor (belt slip via speed/current correlation), crusher, ventilation, pumps, tailings dam (piezometer/level/rainfall packs), dust, diesel/fuel, personnel/equipment tracking (LoRa tags) | P0 (wedge) | L | Regional differentiator; references exist |
| **Water Utilities** | reservoir, pump stations, quality (pH/turbidity/chlorine), pressure zones, leak detection (night-flow analysis) | P1 | M | Builds directly on shipped water twins |
| **Energy** | smart metering, solar (leverages existing solar twin), gensets, batteries/UPS, load forecasting (AI tie-in) | P1 | M | Existing demo depth |
| **Manufacturing** | OEE, downtime (Pareto), machine health, shift reports | P2 | M | Bigger market, harder sales; after references |
| **Agriculture** | irrigation, soil moisture, cold chain | P3 | S-M | Opportunistic; LoRa strength applies |
| **Smart Buildings** | HVAC (existing twin), energy, occupancy | P3 | S-M | Via reseller channel, not direct |
| **Camera/CV** | PPE, smoke/fire, intrusion, vehicle counting — wrap off-the-shelf models, events→alarm engine | P2 | M | Buy/wrap, never train from scratch |

---

## 6. The AI Platform — the Centerpiece

**Architecture principle:** agents are thin; the platform is thick. Every agent = system prompt +
scoped MCP toolset + event triggers. All heavy lifting (queries, alarms, reports) lives in platform
APIs that humans and agents share. Frontier-hosted LLMs (Claude API) first; self-hosting only when
unit economics or air-gap demands it. Per-tenant token metering from day one (billing tie-in).

### 6.1 Foundations (build in this order)

| # | Foundation | What | Effort | Priority |
|---|---|---|---|---|
| F1 | **Gito MCP Server** | Expose existing REST surface as typed MCP tools (list assets, query telemetry, alarms, acknowledge, command devices w/ approval gates). Instantly makes Gito usable from Claude/any agent client — a product in itself for engineer customers. | M | P0 |
| F2 | **NL Telemetry Query (NLQ)** | Text→guarded SQL over Timescale (templated query plans, tenant-scoped, cited). "Show pump 3 flow vs pressure last week" → chart + data. | M | P0 |
| F3 | **Knowledge Base (RAG)** | pgvector over uploaded manuals/schematics/SOPs + auto-ingested alarm history and maintenance notes. Citations mandatory. No external vector DB until pgvector hurts. | M | P0 |
| F4 | **Insight/anomaly pipeline** | Statistical first (EWMA, seasonal decomposition, rate-of-change, flatline/stuck-sensor detection) running in the processor; learned models (per-metric baselines) later. Emits `insight` events into the alarm/notification flow. | M→L | P1 |
| F5 | **Agent runtime** | Server-side agent loop (Claude Agent SDK) with: shared memory (Postgres), event subscriptions (Redis streams), tool allow-lists per role, human-approval gates for any actuation, full audit of every tool call. | L | P1 |

### 6.2 The agents (ruthless sequencing)

**Ship ONE agent first and make it undeniable: the Operations Assistant** — chat (web+mobile+voice)
that answers "why did production drop yesterday?", "which site consumed the most diesel?", "show me
abnormal pump behaviour" using F1–F4, with citations to tags/alarms/history. It wows in demos,
touches every module, and forces the foundations to be real. Everything else derives from it:

| Agent | Trigger | Adds on top of foundations | Priority |
|---|---|---|---|
| Operations Assistant | user chat/voice | — (the foundation proof) | **P0** |
| Reporting Agent | schedule/event/user | report templates (exec/shift/weekly/ESG), branded PDF/email delivery | P1 (fast follow — near-pure LLM + existing data) |
| Maintenance Engineer | insight events | RUL estimates (start simple: runtime-hours + vibration/temp trends), work-order objects + CMMS webhooks, repair recommendations from KB | P1 |
| Data Analyst | schedule/user | correlation mining across metrics, trend narratives, "what changed" diffs | P2 |
| Safety/Environmental | threshold+CV events | dust/gas/PPE playbooks, incident timelines, compliance evidence packs | P2 (sells in mining) |
| Reliability Agent | continuous | fleet-wide asset health scoring, maintenance prioritization | P2 |
| Compliance Agent | schedule | ESG/regulatory report automation (mining: water use, dust, energy) | P3 |
| PLC Engineer | user | tag dictionary understanding, logic explanation from uploaded programs, value sanity checks. **Read-only forever by default; ladder generation stays advisory.** | P3 (credibility risk if rushed) |
| SCADA Assistant / Customer Success | user/telemetry | migration helpers; usage-based onboarding nudges | P3 |

**Collaboration model:** agents don't chat with each other free-form. They communicate through
platform artifacts — one agent's output (insight, work order, report) is an event another agent's
trigger consumes. Deterministic, auditable, debuggable. MCP shared toolset + Postgres shared memory
+ Redis event bus. No agent-to-agent improv until there's a proven need.

### 6.3 AI Digital Twin

Extend the shipped SVG twin system (display slots, smoothed values) with: **predicted-state
rendering** (ghost needle showing where the value is heading; time-scrub slider over history and
forecast), health halo (green→amber→red from asset health score), and "explain this asset" — click
any twin → Operations Assistant seeded with that asset's context. Effort: M. Differentiator: no
competitor renders live *and predicted* state in a lightweight web twin without a 3D consulting project.

### 6.4 Edge AI (kept honest)

Local anomaly scoring (statistical + small ONNX models) in the edge gateway: yes, early. Local LLM
on gateways: not before Y3 — small-model quality/cost curve will decide; design the agent runtime so
the model endpoint is swappable. Offline mode = local rules + buffering + local twin cache, not
offline chat.

---

## 7. Connectivity & Edge Strategy

**Gito Edge Gateway (the second product).** Python/Go services in Docker on industrial Linux
(Pi CM4/5, OnLogic, Moxa, Teltonika): driver host + local rule engine + store-and-forward buffer
(SQLite WAL) + fleet agent (config pull, OTA via container tags, health heartbeat). Speaks the SAME
event schema as cloud ingest — a device behind a gateway is indistinguishable from a cloud-direct one.
Provisioning: X.509 per-gateway certs, claim-code onboarding UX (type code from sticker → tenant-bound).
Effort: L. Priority: **P0 — this is the moat.**

**Driver sequence (wedge-market demand order):**
1. **Modbus TCP** (wrap `pymodbus`) — ubiquitous in water/energy. Effort S-M.
2. **OPC-UA client** (wrap `asyncua`) — the mining/manufacturing door-opener. Effort M.
3. **Sparkplug B** (consume + publish) — instant compatibility with Ignition-centric plants; also our
   internal normalization layer. Effort M.
4. **Modbus RTU/serial** (gateway-side) — brownfield reality. Effort S.
5. **Siemens S7** (wrap `python-snap7`, licensing check) — manufacturing expansion. Effort M.
6. **BACnet** (buildings, via reseller pull), **DNP3/IEC-61850** (utilities — partner/buy; certification
   burden makes these Y3+ unless a lighthouse customer funds it). EtherNet/IP via third-party lib when pulled.

**Scaling the ingest path:** current Redis streams + Timescale hold to ~10–50k msg/s with partitioned
consumers — that is YEARS of runway in the wedge. Triggers for change, pre-agreed: sustained >50k msg/s
or multi-region → Kafka/Redpanda + Timescale partitioning per-tenant-shard. Written down so nobody
"preemptively Kafkas" the stack.

---

## 8. Security & Compliance Path

| Step | What | When | Effort |
|---|---|---|---|
| MFA (TOTP) + session hardening | table stakes | Y1-H1 | S |
| SSO: OIDC first, SAML second | enterprise door-opener | Y1-H2 | M |
| Secrets mgr + cert lifecycle (edge PKI, rotation) | with Edge GA | Y1-H2 | M |
| Audit completeness (every mutation + agent tool call) | with agent runtime | Y1 | S (extend existing) |
| SOC 2 Type I → II | SaaS credibility; start evidence automation early | Y2 | M + $ |
| ISO 27001 | when enterprise deals demand; ~Y3 | Y3 | M + $$ |
| IEC 62443 alignment | design edge to 62443-4-2 SL1→SL2 expectations (zones/conduits respected: gateway = conduit, no inbound ports, outbound-only mTLS); formal cert only if a customer pays for it | design now, cert later | M |
| Deployment models | SaaS (now) → single-tenant VPC (Y2, same compose/helm) → on-prem/air-gapped lite (Y3 — mining reality; edge-heavy + local core subset, no agent cloud dependency) | phased | L |

Zero-trust posture: mTLS edge↔cloud, per-tenant token metering, RLS stays the bedrock (it has
already proven itself), agent actuation always behind human approval gates + typed allow-lists.

---

## 9. Revenue Architecture

| Stream | Model | Notes |
|---|---|---|
| Platform subscription | per-monitored-asset/month, tiered (Starter/Pro/Enterprise); unlimited users, metrics & dashboards | anti-per-tag positioning vs AVEVA/PTC |
| AI tier | per-tenant add-on: assistant + reports + insights, metered fair-use tokens | maps directly to LLM COGS |
| Industry modules | per-module activation fee or bundle tiers | marketplace mechanics from day one, even when all modules are first-party |
| Edge gateways | hardware margin + per-gateway fleet fee | recurring, sticky |
| Marketplace rev-share | 70/30 on third-party packs (Y3+) | integrators become distribution |
| White-label | reseller licensing (already implicit in "client brings own ChirpStack" model) | Southern-Africa SI channel is the cheap sales force |
| Managed services / SLA | monitoring-as-a-service tiers for operators without control rooms | high-margin services on own platform |

Billing build: wrap Stripe (or Paystack/local for ZAR) behind a `billing` module; entitlements =
license records checked at module boundaries. Effort M. Priority P1 (needed before self-serve).

---

## 10. Five-Year Roadmap

**Y1-H1 — "Data moat + first wow" (next 6 months)**
Asset registry refactor · Edge Gateway alpha (Modbus TCP + OPC-UA, buffering, fleet basics) ·
MCP server (F1) + NLQ (F2) · Operations Assistant beta on top · MFA · billing skeleton ·
Mining module v1 (pumps/conveyor/dust packs on existing twin+alarm engines) · 2–3 lighthouse deployments.

**Y1-H2 — "Sellable platform"**
Edge GA (+ Sparkplug B, RTU) · KB/RAG (F3) · Reporting Agent · insight pipeline v1 (F4) ·
OIDC SSO · self-serve onboarding + billing live · Water module · twin predicted-state v1 ·
white-label pilot with one SI.

**Y2 — "AI operations, proven"**
Agent runtime hardened (F5) + Maintenance Engineer + Data Analyst agents · CV module (wrapped models)
· Energy module + load forecasting · SOC 2 · single-tenant VPC offering · S7 driver ·
mobile app to parity (assistant-first UX) · marketplace infrastructure (first-party packs as installable units).

**Y3 — "Ecosystem"**
Third-party marketplace opens (drivers/packs/agents, sandboxed, rev-share) · Safety/Reliability/
Compliance agents · Manufacturing/OEE module · on-prem lite for air-gapped mines · ISO 27001 ·
BACnet + utility-protocol partnerships · edge AI scoring GA.

**Y4–Y5 — "Autonomous operations"**
Closed-loop automation with graduated autonomy (recommend → approve-to-act → bounded auto-act with
guardrails + insurance-grade audit) · fleet-wide cross-tenant benchmarking (privacy-preserving) ·
international mid-market expansion via resellers · local-LLM edge option if economics land ·
platform = the industrial MCP hub others integrate INTO.

---

## 11. Game-Changers (not shipped by incumbents today, likely standard by 2031)

1. **Conversational operations with citations** — every AI answer links to the tags/alarms/history
   it used. Trust is the feature; C3/Maximo "AI" doesn't cite.
2. **MCP-native platform** — Gito as the industrial MCP server: customers' own AI (Claude, Copilot)
   operates their plant through our governed tools. We become infrastructure, not just an app.
3. **Predicted-state digital twins in the browser** — live + forecast ghost state, no 3D consulting
   project, authored in hours via the template skill (already proven internally).
4. **Agent-authored asset packs** — "we bought a new crusher model" → agent drafts device type, twin,
   alarm pack, report template from the manual PDF; human approves. Marketplace content at AI speed.
5. **Unlimited-metrics per-asset pricing** — does to AVEVA/PTC what Ignition's unlimited tags did to
   legacy SCADA licensing.
6. **Claim-code edge onboarding** — gateway online → typed code → streaming in under 5 minutes;
   consumer-grade UX in an industry that budgets weeks for commissioning.
7. **Graduated autonomy with audit-grade guardrails** — the bridge from monitoring to *operating*,
   crossed at the customer's pace, every agent action attributable and reversible.
8. **Shift-handover intelligence** — auto-generated handover briefs (what alarmed, what changed, what
   to watch) — tiny feature, daily habit, brutal retention.

---

## 12. What We Deliberately Do NOT Do

- No microservice rewrite; no Kafka before the written triggers fire (§7).
- No 3D/Unity twin projects; SVG/web twins are the differentiator, not a compromise.
- No training foundation/CV models from scratch — wrap and fine-tune only.
- No PLC write-access by AI without human approval gates — ever, at any autonomy tier.
- No per-tag or per-seat pricing, even when enterprise procurement asks for it.
- No horizontal "everything platform" marketing — wedge first (mining/water/energy, Southern Africa),
  expand from references.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| 2-dev team overreach | roadmap gates: nothing in H2 starts until H1 lighthouse metrics hit; AI-agent development leverage is the multiplier but review capacity is the ceiling |
| LLM COGS erode AI-tier margin | metering from day one; caching; small-model routing for cheap tasks |
| Incumbent bundling (Siemens/AWS give it away) | wedge depth + channel intimacy + pricing they structurally can't match |
| Driver certification burden (DNP3/61850) | partner/defer; don't self-certify utility protocols early |
| AI trust incident (wrong answer → bad decision) | citations mandatory, confidence surfacing, approval gates, incident playbook |
| Single-founder key-person risk | this document + repo skills/docs ARE the mitigation — keep decisions written |

---

*Next actions: (1) adversarial review of this draft by multi-agent panel (queued — subagent limits reset 12:10am);
(2) asset-registry design doc; (3) Edge Gateway alpha spec; (4) MCP server spec on existing routers.*
