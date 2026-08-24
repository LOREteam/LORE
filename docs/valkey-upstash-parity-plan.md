# Valkey and Upstash REST parity plan

Status: selected parity-runtime candidate; not pulled, deployed, or executed.
No credential, network endpoint, or live Redis/Valkey result is recorded here.

## Selected candidate

- Engine: Valkey `8.1.9`.
- Image: the official `valkey/valkey` multi-platform manifest observed on
  2026-08-24, pinned as
  `valkey/valkey@sha256:837f92eff9f89afee3b07cd8c43a91c2ff72d539d7e895c9696c67d014fa9eb2`.
- Variant used for the parity harness: the corresponding `8.1.9-alpine` tag
  only as a human-readable provenance label; deployments must use the digest
  reference above, record their resolved platform manifest, and reject a
  mismatch.

The official image is not safe to publish directly: its documentation states
that protected mode is off by default for container networking. Keep Valkey on
an internal network, require authentication, deny host-port publication, and
place any HTTPS endpoint behind authenticated infrastructure. This is a
candidate for an isolated staging/parity runtime, not a selection of a managed
production provider or evidence that a daemon is currently available.

Sources consulted on 2026-08-24:

- <https://hub.docker.com/r/valkey/valkey>
- <https://hub.docker.com/layers/valkey/valkey/8.1-alpine/images/sha256-837f92eff9f89afee3b07cd8c43a91c2ff72d539d7e895c9696c67d014fa9eb2>
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
