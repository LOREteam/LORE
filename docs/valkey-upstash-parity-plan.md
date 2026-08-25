# Valkey and Upstash REST parity plan

Status: direct engine execution covers all three production Lua scripts, and a
hermetic HTTPS/REST check covers the real rate-limit, keeper daily-budget, and
admin-session rotation application paths from two Node processes at exact local
SHA `9ce4e5ca9809cda7b856603e2f51e1200b0f7735`. A separate clean-HEAD direct
engine run at `154b29b592182600d118736f1c2d312d92fcc9a3` proves local AOF
restart and RDB restore semantics. A clean-HEAD role-wiring run at
`cc0d5891159065eaa51d59607b250eda1aee3014` also binds the actual local
indexer/keeper/monitor seams without starting a signer or live monitor loop.
Hosted route/browser cookie behavior, provider-managed persistence, externally
retained backup, deployed process rehearsal, and external relational DB restore
remain open. No endpoint or durable credential is recorded.

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
- Local REST façade only: third-party SRH tag `0.0.10`, observed OCI index
  `sha256:65128347949bca511e448fd7238780d624573d74c22b79155a7563db19e9b678`,
  executed Linux AMD64 manifest
  `sha256:01d66211581ebd552e07292e3b73f1f475e52c48aa725049809aa09a7ba23238`.
- Local TLS proxy only: Caddy tag `2.11.4-alpine`, observed OCI index
  `sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648`,
  executed Linux AMD64 manifest
  `sha256:98eb57d882ccd5213d1688764db10c1ca2c58a1ca3a6717a3411ad798f7a423a`.
  Runtime self-report is `v2.11.4`; SRH does not expose a self-reported version,
  so only its immutable executed manifest and selection tag are claimed.

The prior `sha256:837f...` reference resolves to `linux/arm/v7`; it was not
used as runtime evidence and must not be selected on an AMD64 host.

The official image is not safe to publish directly: its documentation states
that protected mode is off by default for container networking. Keep Valkey on
an internal network, require authentication, deny host-port publication, and
place any HTTPS endpoint behind authenticated infrastructure. This is a
candidate for isolated staging/parity. The local run below is not selection or
evidence of a managed production provider.

Sources consulted on 2026-08-25:

- <https://hub.docker.com/r/valkey/valkey>
- `docker buildx imagetools inspect valkey/valkey:8.1.9` (2026-08-25;
  index and Linux AMD64 manifest above)
- <https://upstash.com/docs/redis/features/restapi>
- <https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval>
- <https://github.com/hiett/serverless-redis-http>

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

## Direct Lua-engine persistence and restore check (2026-08-25)

The `test:valkey:lua-engine` package entry targets
`scripts/test-valkey-lua-engine.mjs`; the retained clean-HEAD run invoked it
with exact Node `24.5.0` at SHA `154b29b592182600d118736f1c2d312d92fcc9a3`.
It extracts and executes the three exact application Lua strings on Valkey
`8.1.9`, pins the OCI index digest, and requests `linux/amd64`. The primary and
restore containers have no network or published ports, run as unprivileged UID
`999` with all capabilities dropped and a read-only root, and mount only owned
OS-temp data directories. A random password remains process-local.

The primary uses exact `appendonly=yes` and `appendfsync=always`. After the
rate-limit, keeper, and session matrices run, a real process restart preserves
their values and absolute expiries. `SAVE` creates a non-empty RDB copied
byte-for-byte to a separate owned backup path. The original state is then
deliberately changed, its container is removed, and a distinct restore
container loads only the backup RDB. It recovers the exact pre-mutation values
and expiry deadlines. Full container IDs and unique ownership labels are checked
before removal; label scans, OS-temp absence, post-cleanup source provenance,
and protected base/WAL/SHM identity must pass before artifact publication.

The redacted artifact is `artifacts/valkey-runtime/valkey-lua-engine.json`,
SHA-256 `4E96A817F1CE5C9DFBE80AA2AF24D2D5D41561C9E7617BF36288442EAAE682A5`.
It records Valkey `8.1.9`, host/container identity, four source bindings, exact
script hashes, backup format/size/hash, and no secret, endpoint, or data body.

This is intentionally **partial** evidence. It is direct TCP CLI testing of a
local engine and owned temporary storage, not provider-managed durability,
externally retained backup, an Upstash-compatible HTTPS restore rehearsal,
deployed web/indexer/bot/monitor recovery, or external relational database
restore. It does not authorize deployment, an external request, or wallet
activity.

## Local HTTPS rate-limit, keeper, and session application check (2026-08-25)

The latest retained clean-HEAD run of `scripts/test-valkey-rest-rate-limit.mjs`
passed at exact local SHA `9ce4e5ca9809cda7b856603e2f51e1200b0f7735` on Windows Node `24.5.0`;
`npm run test:valkey:rest-parity` is its explicit combined package entry. The harness starts
the three exact Linux AMD64 manifests above on two isolated Docker networks:
Valkey and SRH publish no host port; only Caddy receives a Docker-assigned
loopback HTTPS port. The
client keeps the production-valid host/SNI `valkey-parity.playlore.xyz`, rejects
the default system CA, and then trusts only the ephemeral Caddy root with normal
certificate verification enabled.

Two independent long-lived Node processes import the real
`consumeExternalRateLimit`, `reserveExternalKeeperDailyBudget`,
`issueAdminSession`, `readAdminSession`, and `rotateAdminSession` seams. They share
one Valkey keyspace and pass
`allowed, allowed, blocked`, positive non-resetting TTL, and exact Lua-script
hash checks. Wrong Bearer fails both raw REST and the production caller;
`{result}` and `{error}` envelopes are exercised. The keeper path proves shared
totals, cross-process replay, conflict without mutation, atomic cost/signature
caps, tightened-policy refusal, server `TIME` plus absolute `PEXPIRETIME` at
the next UTC midnight, replay/error deadline preservation, prior-day reset,
malformed-state refusal without mutation, and wrong-Bearer refusal without
created state. The session path issues version 1 through replica A, validates it
through A and B, races the same validated state through both replicas with one
exact CAS winner, validates version 2 from both replicas, rejects the old cookie
for authenticated reads, and proves stale rotation plus wrong-Bearer rotation
leave the active record and absolute deadline unchanged. This is rotation-CAS
evidence, not a broad claim about every use of an old signed cookie.

Startup, pre-replica, post-execution, and post-cleanup HEAD/blob/content captures
match across seven executed source paths. Every replica reports the captured
production-source digests, acknowledges SQLite close, and exits normally. The
clean post-commit artifact reports `allRelevantFilesBoundToRevision=true`,
`trackedWorktreeClean=true`, and `stableThroughCleanup=true`; Linux AMD64
container identity is kept distinct from the Windows Node host identity.

Secrets exist only in process memory or exclusive temporary files. Every
attempted container/network carries a unique run label; full IDs and labels are
verified before ID-based removal, followed by exact-name and label scans. The
post-incident protected SQLite base/WAL/SHM pre/post identity is unchanged.
Redacted evidence is in
`artifacts/valkey-runtime/valkey-rest-rate-limit.json`.

This remains **partial local parity**. It does not prove the managed provider,
deployed web replicas, hosted `/api/admin/auth`, browser `Set-Cookie` enforcement,
indexer/bot/monitor, persistent external storage, backup/restore, or cross-host
behavior.

## Local runtime-role wiring check (2026-08-25)

`test:runtime-role-topology` invokes
`scripts/test-runtime-role-topology.mjs`. Its retained clean-HEAD run uses exact
Windows Node `24.5.0` at SHA
`cc0d5891159065eaa51d59607b250eda1aee3014` and runs four isolated child
checks with an empty dotenv file and unique OS-temp monitor directory:

- the actual indexer run and watch entrypoints fail closed on an active
  two-process SQLite lease before any RPC work, preserve opaque ownership, and
  recover only after bounded crash expiry;
- a separate actual indexer crash/restart test uses two loopback-only RPC
  fixtures, rejects a non-canonical fork, resumes from the committed cursor,
  and persists only finalized canonical rows;
- two keeper workers execute the production SQLite daily-budget seam that
  `bot.ts` calls before signing, proving restart persistence, atomic final-slot
  admission, idempotency, cost/signature caps, and malformed-state refusal;
- the actual monitor summary preflight and restart/recovery drill report zero
  duplicate alerts, reject repo-local backup configuration, and remove all
  owned state without starting the live polling loop.

The orchestrator binds all `12` relevant blobs to that exact SHA, requires a
clean tracked tree for retained publication, bounds child output/runtime, and
verifies the protected SQLite base/WAL/SHM identity before and after. The
retained artifact is
`artifacts/runtime-topology/local-role-topology.json`, SHA-256
`F6949B9AB379C3350A5918CC20CC6D9BB8134E7E9DAEB3F074936D47419C0FE7`.
It explicitly records that the bot entrypoint/signer and live monitor loop were
not started, no external endpoint was configured, and no wallet or transaction
action occurred.

This is **local role-wiring partial evidence**, complementary to the separate
Valkey HTTPS and persistence artifacts above. The roles do not share one
deployed external store in this run. It does not prove deployed process
identity, provider durability, cross-host coordination, external database
restore, real alert delivery, or any wallet/signing/RPC/Preview/chain behavior.

## Runtime evidence required

After a reviewed provider/host and secret configuration are available, repeat
the real application requests against the deployed shared endpoint with two
independent deployed client identities:

1. `RATE_LIMIT_SCRIPT`: same bucket/key increments once globally, expiry is
   set only on first increment, and the rejected request reports bounded retry.
2. `KEEPER_DAILY_BUDGET_SCRIPT`: first reservation succeeds; byte-identical
   retry returns `already_reserved`; changed binding conflicts; count/cost caps
   and malformed stored state fail closed; server `TIME` rollover resets only
   the old UTC-day record.
3. `ROTATE_SESSION_SCRIPT`: rotation is atomic, stale rotation state is rejected
   without extending the active deadline, and both replicas observe the same
   resulting session identity.

Capture only redacted command/result summaries, image digest, resolved
platform digest, façade revision, engine `INFO`/version summary, two-replica
identities, and explicit failure cases. Do not record URL tokens, passwords,
or response bodies containing secrets.

## Acceptance and stop conditions

The deployed runtime is not a valid production gate until all three scripts run
through its real Valkey Lua engine and the same HTTPS REST contract used by the
app, with the shared store seen by both web replicas, indexer, bot, and monitor
where applicable. The local proof above does not substitute for that deployed
identity, persistence, restart, or restore evidence. JavaScript simulations,
direct TCP-only tests, a successful image pull, or a single local container are
insufficient. If the HTTP façade changes
script, key, authentication, error, timeout, or response semantics, treat
parity as failed and stop before any production or wallet action.
