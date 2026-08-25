# Valkey and Upstash REST parity plan

Status: a direct, isolated Lua-engine check passed; HTTPS REST parity and
shared-runtime evidence remain open. No endpoint or durable credential is
recorded here.

## Selected candidate

- Engine: Valkey `8.1.9`.
- Image: the official `valkey/valkey:8.1.9` multi-platform OCI index observed
  on 2026-08-25, pinned as
  `valkey/valkey@sha256:f0ba225266310efba5fb33383e21c64fbd07907304224786c780606e7ebd7327`.
- Required host platform for this harness: `linux/amd64`, resolved from that
  index as
  `sha256:3d9b17f2fa3d938c63c0e951a669f8752f57fdee2d771a757830f66b4c8cc0bf`.
  Deployments must pin the index, record the resolved platform manifest, and
  reject a platform or digest mismatch.

The prior `sha256:837f...` reference resolves to `linux/arm/v7`; it was not
used as runtime evidence and must not be selected on an AMD64 host.

The official image is not safe to publish directly: its documentation states
that protected mode is off by default for container networking. Keep Valkey on
an internal network, require authentication, deny host-port publication, and
place any HTTPS endpoint behind authenticated infrastructure. This is a
candidate for an isolated staging/parity runtime, not a selection of a managed
production provider or evidence that a daemon is currently available.

Sources consulted on 2026-08-25:

- <https://hub.docker.com/r/valkey/valkey>
- `docker buildx imagetools inspect valkey/valkey:8.1.9` (2026-08-25;
  index and Linux AMD64 manifest above)
- <https://upstash.com/docs/redis/features/restapi>
- <https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval>

## Required HTTP compatibility boundary

The application does not speak Redis TCP. It requires a public HTTPS endpoint
with `Authorization: Bearer`, JSON command arrays, bounded JSON responses, and
server-side `EVAL`. In particular,
`app/api/_lib/externalRateLimit.ts` sends:

```json
["EVAL", "<lua>", "1", "<key>", "<arguments...>"]
```

and accepts only Upstash-shaped JSON `{ "result": ... }` or `{ "error": ... }`.
Therefore a bare Valkey container is not parity. Before testing the app against
it, provide an internal HTTPS façade that preserves this request ordering,
authentication, response shape, bounded errors, and scripting semantics. It
must not expose a Standard token to browsers, log credentials, silently proxy
unknown commands, or fall back to a local in-memory store.

## Direct Lua-engine check (2026-08-25)

`npm run test:valkey:lua-engine` directly executes the three exact Lua strings
currently extracted from the application on Valkey `8.1.9`. The test pins the
OCI index digest and requests `linux/amd64`; it starts a unique container with
no network, no published ports, read-only root, no persistence, temporary
`/tmp` and `/data`, a random process-only password, and only the entrypoint
capabilities (`CHOWN`, `SETUID`, `SETGID`) needed by the official image.

The 2026-08-25 run passed these engine-level behaviors: global rate-limit
increment/TTL, keeper reservation/replay/conflict/cap/malformed-state handling,
and atomic session rotation/replay rejection. Its redacted artifact is
`artifacts/valkey-runtime/valkey-lua-engine.json`; it records Valkey `8.1.9`,
the image/platform digest, source-script hashes, and no secret or endpoint.
The container is stopped and forcibly removed in `finally`, including on a test
failure.

This is intentionally **partial** evidence. It is direct TCP CLI testing of a
single ephemeral container, not an Upstash-compatible HTTPS façade, two
independent application replicas, a persistent external database, or restore
evidence. It does not authorize deployment, an external request, or wallet
activity.

## Runtime evidence required

After a reviewed daemon/host and secret configuration are available, execute
the real application requests against the shared endpoint with two independent
client identities:

1. `RATE_LIMIT_SCRIPT`: same bucket/key increments once globally, expiry is
   set only on first increment, and the rejected request reports bounded retry.
2. `KEEPER_DAILY_BUDGET_SCRIPT`: first reservation succeeds; byte-identical
   retry returns `already_reserved`; changed binding conflicts; count/cost caps
   and malformed stored state fail closed; server `TIME` rollover resets only
   the old UTC-day record.
3. `ROTATE_SESSION_SCRIPT`: rotation is atomic, stale/replayed session state is
   rejected, and both replicas observe the same resulting session identity.

Capture only redacted command/result summaries, image digest, resolved
platform digest, façade revision, engine `INFO`/version summary, two-replica
identities, and explicit failure cases. Do not record URL tokens, passwords,
or response bodies containing secrets.

## Acceptance and stop conditions

This runtime is not a valid gate until all three scripts run on the real
Valkey Lua engine through the same HTTPS REST contract used by the app, with
the shared store seen by both web replicas, indexer, bot, and monitor where
applicable. JavaScript simulations, direct TCP-only tests, a successful image
pull, or a single local container are insufficient. If the HTTP façade changes
script, key, authentication, error, timeout, or response semantics, treat
parity as failed and stop before any production or wallet action.
