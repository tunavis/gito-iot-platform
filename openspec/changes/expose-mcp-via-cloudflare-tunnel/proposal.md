## Why

MCP is enabled on the staging box and unreachable by anything outside it.
`nginx.conf` routes `/api/`, `/api/v1/ws/`, `/health` and `/`, so `/mcp` falls
through to the Next.js frontend and 404s; the api container publishes no port;
and `192.168.0.9` is a LAN address that hosted services cannot reach inbound at
all. Claude Desktop on the same network could talk to it once routed. ChatGPT
never could.

**Decision (2026-08-01): use a Cloudflare Tunnel rather than reverse-proxy rules
plus port forwarding.** The tunnel connects *outbound* from the box, so nothing
inbound is opened, no firewall or NAT rule is needed, and TLS terminates at
Cloudflare. It also puts an identity layer in front of the endpoint, which
matters more here than for an ordinary web app: this URL exposes a tenant's fleet
to whoever holds a token.

## What Changes

- **New** a `cloudflared` tunnel on the staging box publishing the MCP endpoint at
  a real hostname, replacing the "add an nginx location" approach.
- **New** access restriction in front of it, so the endpoint is reachable by
  named people and machines rather than the internet.
- **Modified** `MCP_ALLOWED_HOSTS` to include the tunnel hostname. The SDK's
  DNS-rebinding check compares the `Host` header exactly; a missing entry surfaces
  as `421`, which looks like a broken deployment rather than a config gap.
- **Modified** `docs/MCP_SERVER.md` connection instructions, which currently
  describe a URL nobody outside the LAN can use.

## The wrinkle that will bite: browser-based Access does not work for MCP clients

Cloudflare Access normally protects a resource with an interactive login that
sets a cookie. **An MCP client cannot complete that flow** — it is not a browser,
it will not follow an identity-provider redirect, and it has nowhere to display a
login page. Putting standard Access in front of `/mcp` produces a tunnel that
works perfectly when tested in a browser and fails for every actual client.

The programmatic path is an Access **service token** — a client ID and secret
sent as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers, which the
client must be able to set alongside the existing `Authorization: Bearer`. So the
practical constraint is:

- **Claude Desktop / config-file clients** — can send custom headers; workable.
- **Hosted connectors that only accept a URL** — cannot; for those the endpoint
  would have to be reachable without a service token, and the protection has to
  come from somewhere else.

This needs deciding before the tunnel is built, not after, because it determines
whether the answer is "service tokens" or "the platform's own credential is the
only gate and it had better be strong enough".

## Which raises the credential question, unavoidably

Today an MCP caller authenticates with a **user's JWT**, valid for
`JWT_EXPIRATION_HOURS = 24`, with no revocation and no scope narrower than that
user's full authority. That is defensible only while the endpoint is unreachable.
The moment it is on the internet, a leaked token is 24 hours of access to a
tenant's fleet with nothing to shut it off.

Adding the tunnel is roughly one line of config. Making the credential model
worth exposing is not. **The ordering is the risk**, and this proposal exists
partly to stop the tunnel being added "just to test" ahead of that decision.

## Capabilities

### Modified Capabilities
- `mcp`: how a client reaches the server, and what it must present to be allowed
  to — currently documented as a bearer token against a LAN address.
- `infrastructure`: the box gains an outbound tunnel; no inbound exposure.

## Impact

**Infrastructure** — a `cloudflared` service on the staging box, a Cloudflare
tunnel and DNS record, and an Access policy or service token. No nginx change and
no port forwarding, which is the point.

**Config** — `MCP_ALLOWED_HOSTS` gains the tunnel hostname.

**Docs** — `docs/MCP_SERVER.md` connection section.

**Not affected** — the REST API and web UI keep reaching the box as they do now.
This adds a path; it removes none.

## Open Questions

- Which clients must connect? The answer decides service tokens versus something
  else, and it is the first question to settle.
- Does the credential model change before or with this? A tenant-scoped API key
  with its own revocation is the option already recorded in the strategy doc; a
  short-lived token would also help.
- Staging only, or is this the pattern for production too? The box was described
  as internal-only "for later use for production one day", so the tunnel may be
  the shape of production access rather than a staging convenience.

## Status

**Proposed, not planned.** Raised 2026-08-01 while the author was away from the
machine that would configure it. Design and tasks deliberately unwritten — the
client question above changes the design materially.
