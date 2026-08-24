# Transactional consent and unified activity ledgers

Status: proposed architecture; not implemented, deployed, or authorization
evidence. This document does not authorize a Preview, RPC call, signature, or
transaction.

## Purpose and non-goals

The current V10 Preview store uses a repository-local exclusive tombstone and
lease. It is intentionally fail-closed, but a coherent local attacker can
rewrite its files and independent web hosts cannot coordinate through it. The
current `scoped_user_activity` SQLite table records indexed bets and claims,
but wallet-transfer history remains a capped browser-side observation.

The target is one externally hosted, transactional, durable system of record
for:

1. one-time, exact V10 execution consent shared by every web replica, worker,
   bot, and operator tool; and
2. user-visible activity events for canonical bets, claims, and wallet
   transfers, with explicit finality and coverage rather than fabricated
   complete history.

The target deliberately does not custody keys, retain mnemonic/private-key
material, convert Preview into consent, perform a chain write, or make
database contents alone a source of truth for chain execution.

## Required deployment decision

Use a managed PostgreSQL-compatible primary database with transactions,
row-level locks, unique constraints, point-in-time recovery, and TLS. Pin the
provider, engine major/minor version, region, HA topology, backup retention,
and immutable infrastructure revision before implementation. Do not treat this
document as that selection or as evidence that an external database exists.

Every writer must use the same database through a service credential with the
minimum table permissions. Browser clients never receive database credentials
and never write ledger rows directly.

## Consent identity and state machine

An execution consent is valid only when it binds all of the following exact
values:

- `chain_id`, canonical contract address, immutable source/deployment SHA, and
  epoch-bound selector requirement;
- SHA-256 of the canonical read-only Preview and its public configuration;
- SHA-256 of the normalized wallet set and of the bounded canary/consent plan;
- explicit role, transaction-count, value, gas, affected-epoch, failure, and
  expiry caps;
- a random server-generated `consent_id` and a separate immutable `run_id`;
- the operator-recorded, separately obtained consent reference and expiry.

`Preview created` is not a consent state. A human approval must be independently
recorded before the row may enter `issued`. Valid transitions are:

```text
draft -> issued -> executing -> submitted -> reconciled
                 |              |             |
                 +-> expired    +-> ambiguous +-> failed
```

`ambiguous` is terminal for automatic retry: reconcile against receipts,
chain nonce, indexer, and activity ledger first. Expiry, cap exhaustion,
binding mismatch, duplicate run, or persistence uncertainty must fail closed.

## Consent schema and transaction protocol

The implementation migration must use a schema equivalent to the following
PostgreSQL design; names/types may change only with a reviewed migration.

```sql
create table execution_consents (
  consent_id uuid primary key,
  run_id uuid not null unique,
  state text not null check (state in
    ('draft','issued','executing','submitted','reconciled','failed','expired','ambiguous')),
  chain_id bigint not null,
  contract_address text not null,
  source_sha char(40) not null,
  preview_sha256 char(64) not null,
  wallet_set_sha256 char(64) not null,
  canary_plan_sha256 char(64) not null,
  consent_plan_sha256 char(64) not null,
  consent_reference_hash char(64) not null,
  caps jsonb not null,
  expires_at timestamptz not null,
  execution_owner text,
  execution_lease_until timestamptz,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create unique index execution_consents_active_binding
  on execution_consents(chain_id, contract_address, preview_sha256,
    wallet_set_sha256, canary_plan_sha256, consent_plan_sha256)
  where state in ('issued','executing','submitted','ambiguous');

create table execution_intents (
  intent_id uuid primary key,
  consent_id uuid not null references execution_consents(consent_id),
  idempotency_key char(64) not null unique,
  ordinal integer not null check (ordinal >= 0),
  role text not null,
  wallet_address text not null,
  epoch numeric(78,0),
  value_wei numeric(78,0) not null default 0,
  gas_cap_wei numeric(78,0) not null,
  status text not null check (status in
    ('prepared','submitted','reconciled','failed','ambiguous')),
  tx_hash text unique,
  request_sha256 char(64) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (consent_id, ordinal)
);

create table execution_consent_audit (
  audit_id bigserial primary key,
  consent_id uuid not null references execution_consents(consent_id),
  occurred_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('operator','web','worker','bot','reconciler')),
  actor_id text not null,
  event_type text not null,
  payload_sha256 char(64) not null,
  previous_hash char(64),
  entry_hash char(64) not null unique
);
```

The service creates `issued` consent and audit entry in one serializable
transaction after validating a separate exact consent. To claim a run, each
writer executes one serializable transaction that locks the row (`FOR UPDATE`),
checks all hashes, current time, caps, and state, then changes only `issued` to
`executing` with its immutable service identity. The transition is conditional
on the row version; zero updated rows means fail closed.

Before a chain provider call, the writer persists the exact intent and its
idempotency key in the same transaction. Chain submission cannot be atomically
committed with the database, so a timeout or process crash after provider
dispatch is `ambiguous`, never a blind retry. After a tx hash is obtained, a
transaction stores it once. The reconciler is the only component permitted to
move `submitted` or `ambiguous` to a final state after receipt/nonce/indexer
checks. Every state change appends a hash-linked audit record; an external
KMS-backed signer or append-only export is required to make privileged database
tampering detectable.

## Unified activity ledger

Store immutable event observations separately from the user-facing projection.
The canonical chain event identity is:

```text
chain_id + transaction_hash + log_index + event_kind
```

For a native transfer without a log, use the normalized transaction hash plus a
receipt-derived discriminator. Never use a display amount, timestamp, or
browser cache key as identity.

```sql
create table chain_event_observations (
  event_key text primary key,
  chain_id bigint not null,
  block_number numeric(78,0) not null,
  block_hash text not null,
  tx_hash text not null,
  log_index integer,
  event_kind text not null check (event_kind in
    ('bet','reward_claim','reward_batch_claim','rebate_claim','rebate_batch_claim','wallet_transfer')),
  subject_wallet text not null,
  counterparty_wallet text,
  token_address text,
  amount_wei numeric(78,0),
  epoch numeric(78,0),
  canonical boolean not null default true,
  finality_status text not null check (finality_status in ('observed','finalized','orphaned')),
  observed_at timestamptz not null default now(),
  unique (chain_id, tx_hash, log_index, event_kind)
);

create index chain_event_subject_cursor on chain_event_observations
  (chain_id, subject_wallet, canonical, block_number desc, event_key desc);
create index chain_event_reorg on chain_event_observations
  (chain_id, block_number, canonical);

create table activity_projection_watermarks (
  chain_id bigint primary key,
  indexed_through_block numeric(78,0) not null,
  finalized_through_block numeric(78,0) not null,
  updated_at timestamptz not null default now()
);
```

The indexer writes a block and all of its observations in one transaction. A
reorg marks affected observations `canonical=false, finality_status='orphaned'`
and rewinds the watermark in the same transaction; rows are retained for audit
instead of being silently deleted. The activity API reads only canonical rows,
returns opaque cursor pagination, `indexedThroughBlock`,
`finalizedThroughBlock`, and `coverage` (`partial`, `observed`, or `finalized`).
It must not report missing ranges or browser-capped wallet transfers as zero.

The current `scoped_user_activity` SQLite projection remains a local,
partial-coverage compatibility source until an external backfill/reconciliation
has been independently verified. Browser `useWalletTransfers` data remains a
read cache only; migration must compare it to canonical events but must never
upload an unverified browser row as ledger fact.

## Operational controls and acceptance evidence

Before enabling more than one writer or web replica, require all of the
following:

1. Database migrations applied to an empty staging database and verified by a
   second service instance using distinct credentials.
2. Concurrency tests: two writers claim one `issued` consent; exactly one wins,
   one audit chain remains valid, and all duplicate intent keys fail closed.
3. Crash tests at each persistence/provider boundary; no ambiguous intent is
   automatically retried before chain reconciliation.
4. Cap tests for wallet, role, transaction, value, gas, epoch, expiry, and
   source/Preview/configuration hash mismatches.
5. Reorg tests covering bet, both single/batch claim kinds, and wallet
   transfers; orphaned rows disappear from the projection but remain auditable.
6. Restore drill proving consent uniqueness, audit continuity, activity
   watermarks, and finalized projection equality after restore.
7. Cross-host evidence: two web replicas plus indexer/bot/monitor use the same
   store, with no local SQLite or browser cache accepted as authority.

No item above is satisfied by local fixtures, JavaScript models, a repository
tombstone, or this design document. Production enablement still requires the
separate final-SHA, CI/security, HTTPS/Privy, runtime-identity, Preview, and
fresh exact-consent gates.
