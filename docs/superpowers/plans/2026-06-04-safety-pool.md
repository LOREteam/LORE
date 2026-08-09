# Safety Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace participation rebate behavior and copy with Safety Pool behavior for players who missed the winning tile.

**Architecture:** Keep existing rebate ABI and route names for compatibility, but change the contract preview/claim math so winners are ineligible and payouts are split over losing-player volume. Update UI/docs/smoke copy to present the feature as Safety Pool.

**Tech Stack:** Solidity contract source, Next.js/React UI, TypeScript hooks, Node smoke and invariant scripts.

---

### Task 1: Contract Safety Pool Formula

**Files:**
- Modify: `scripts/test-contract-v9-invariants.mjs`
- Modify: `contracts/LineaOreV9.sol`

- [ ] Add a failing invariant that `_previewRebate` checks epoch resolution, excludes users with a bet on the winning tile, and divides by losing-player volume.
- [ ] Run `npm.cmd run test:contract` and verify it fails because the current contract still divides by total pool.
- [ ] Update `_previewRebate` to return zero before resolution, return zero for any user with winning-tile volume, compute `losingVolume = totalPool - tilePools[epoch][winningTile]`, and divide by `losingVolume`.
- [ ] Run `npm.cmd run test:contract` and verify it passes.

### Task 2: User-Facing Safety Pool Copy

**Files:**
- Modify: `app/components/RebatePanel.tsx`
- Modify: `app/components/MobileTabNav.tsx`
- Modify: `app/components/Sidebar.tsx`
- Modify: `app/components/FirstVisitTutorial.tsx`
- Modify: `app/components/FAQ.tsx`
- Modify: `app/components/WhitePaper.tsx`
- Modify: `scripts/smoke-browser.mjs`
- Modify: `docs/mainnet-readiness-checklist.md`
- Modify: `docs/governance-migration.md`

- [ ] Replace visible Rebate/Gas Burn Bonus/Participation Rebate copy with Safety Pool language.
- [ ] Keep internal route/tab id `rebate` unchanged.
- [ ] Update smoke browser expectations from `Gas Burn Bonus` to `Safety Pool`.
- [ ] Run `npm.cmd run lint` and `npm.cmd run typecheck`.

### Task 3: Full Verification

**Files:**
- No production files expected after Task 2.

- [ ] Run `npm.cmd run build`.
- [ ] Start production server on `http://localhost:3000`.
- [ ] Run `SMOKE_BASE_URL=http://localhost:3000 npm.cmd run smoke:browser`.
- [ ] Run `SMOKE_BASE_URL=http://localhost:3000 npm.cmd run smoke:http`.
- [ ] Check `git status --short --branch` and confirm only intended files changed.
