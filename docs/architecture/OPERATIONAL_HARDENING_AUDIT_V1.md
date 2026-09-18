# Operational Hardening Audit V1

**Status:** Implementation baseline for Operational Hardening V1.  
**Base production SHA at start:** `a15333a78e96bdf0771447cbb87bbb20411d6300`  
**Bella:** do not mutate. Categories Burgers 7 / Menuer 8 / Durum 9 / Pita 10 / Kebab 11, products 0.

This audit traces the **authoritative production paths** as of the hardening pass. Issues are recorded with a minimal fix. None of these weaken approval, readback, or verification.

---

## Production path map

1. **Create workflow** — portal job → `scheduleMigrationJob` → `runMigrationJob` (extract → intelligence → TargetMenu → live snapshot → `buildDryRunWritePlan` → freeze `ExecutionBundleV1` → review/approval).
2. **QA workflow** — same worker with `QA_RECONCILE`, deep snapshot required `LIVE_COMPLETE`.
3. **Operator approval** — `AWAITING_OPERATOR_APPROVAL` → `schedulePostReviewLiveIfReady` → load `execution-bundle.json` (no replan).
4. **WritePlan generation** — interleaved category/product order is frozen **before** hash/approval (`preserveOperationOrder` on execute).
5. **Live execution** — `executePortalLiveWrites` requires the bundle, pre-write gate, exact operations.
6. **Readback** — DestinationPort list/edit reads; only VERIFIED counts.
7. **Recovery** — `RecoveryPlanV2` from frozen plan + operation history + live snapshot; `executeAutomatically: false`, `neverAutoDelete: true`.
8. **Publication** — still a separate later stage. Not part of content writes.
9. **Playwright lifecycle** — Chromium baked in `Dockerfile.portal` `/ms-playwright`. Runtime asserts `chromium.executablePath()`. No background install.
10. **Railway build/start** — image build installs Chromium once; `portal-start` does not download.
11. **Job persistence** — `portal.sqlite` + `job_leases` + `destination_write_locks` + `blocker_records`.
12. **Portal worker** — in-process worker with durable lease; not a microservice.
13. **SQLite** — WAL, `busy_timeout=5000`, `foreign_keys=ON`.
14. **Artifacts** — under `PORTAL_DATA_DIR` (`/data/portal` in production).
15. **Deployment provenance** — baked `deploy-meta.json` preferred by `/api/version`.
16. **CI** — `check:fast` local; `check:ship` full; CI parallelizes independent suites.
17. **Browser login** — `loginTahAdmin` + host lock; session not shared across jobs (`BrowserRuntime` context per job).
18. **Destination snapshots** — `LIVE_COMPLETE | LIVE_PARTIAL_WITH_ERRORS | OFFLINE_EXPLICIT | FAILED`.
19. **Contract checks** — `probeAdminContract` + fingerprint comparison immediately before mutation.
20. **Legacy milestone scripts** — evidence only. Production must not import `scripts/m*`.

---

## Issues

### OH-001 Post-approval replan
- **Current behavior:** `executePortalLiveWrites` could rebuild a dry plan after approval.
- **Risk:** Approved plan ≠ executed plan.
- **Time cost:** High (wrong menu). **Frequency:** Every live execute. **Production impact:** Critical.
- **Root cause:** Live path treated TargetMenu as the executable artifact.
- **Minimal solution:** `ExecutionBundleV1` frozen at ARTIFACTS; execute exact operations.
- **Safety:** Strengthens approval. **Test:** approved plan hash == executed hash.

### OH-002 Assumed hostOk/contractMatch
- **Current behavior:** Executor gate could be passed as `true` without evidence.
- **Risk:** Mutation against drifted contract/host. **Impact:** Critical.
- **Root cause:** Gate flags were caller assertions.
- **Minimal solution:** `evaluatePreWriteGate` from page URL, probe, snapshot hash, SHA.
- **Test:** contract drift / wrong host fail closed.

### OH-003 Default `*` live-write allowlist
- **Current behavior:** Unset `PORTAL_LIVE_WRITE_HOSTS` meant any host.
- **Risk:** Credential presence enabled every restaurant. **Impact:** Critical.
- **Minimal solution:** Default `bundle-bound`; `*` is emergency override.
- **Test:** missing expected host fails closed.

### OH-004 In-process `void runMigrationJob`
- **Current behavior:** Job state died with the web process.
- **Risk:** Indefinite spinning jobs; lost checkpoints. **Impact:** High.
- **Minimal solution:** SQLite job leases + heartbeat + reclaim on boot.
- **Test:** lease expire / reclaim.

### OH-005 No destination write lock
- **Current behavior:** Two mutating jobs could target one merchant.
- **Risk:** Duplicate/racy writes. **Impact:** High.
- **Minimal solution:** `destination_write_locks` keyed by normalized host.
- **Test:** second job `DESTINATION_WRITE_LOCKED`.

### OH-006 Fake empty destination
- **Current behavior:** Login/browser failure returned `categories: []` as empty catalog.
- **Risk:** CREATE planned against a fake-empty restaurant. **Impact:** Critical.
- **Minimal solution:** Explicit `FAILED` / `OFFLINE_EXPLICIT`; CREATE/QA require `LIVE_COMPLETE`.
- **Test:** FAILED cannot authorize CREATE.

### OH-007 Silent pagination cap
- **Current behavior:** Product listing stopped after a fixed page count and looked complete.
- **Risk:** Partial catalog treated as whole. **Impact:** High.
- **Minimal solution:** Continue until end; cap ⇒ `SNAPSHOT_TRUNCATED`.
- **Test:** truncated listing is an error.

### OH-008 Deep snapshot N+1
- **Current behavior:** `readProduct` listed the catalog every time.
- **Risk:** Quadratic runtime. **Impact:** High time cost.
- **Minimal solution:** `readProduct(id, { listRow })`; 1 list + N edit reads.
- **Test:** complexity invariant.

### OH-009 Runtime Playwright install
- **Current behavior:** CI + `portal:build` + `portal-start` + Create wait (180s).
- **Risk:** Slow, flaky, hangs. **Impact:** High.
- **Minimal solution:** Bake Chromium; runtime assert only.
- **Test:** missing executable ⇒ `BROWSER_RUNTIME_UNAVAILABLE`.

### OH-010 Arbitrary UI sleeps
- **Current behavior:** `waitForTimeout` used as UI sync in adapter/form fill.
- **Risk:** Flakes and wasted time. **Impact:** Medium.
- **Minimal solution:** Wait for attached/detached/row count. Keep retry backoff only.
- **Test:** `src/` has no `waitForTimeout`.

### OH-011 Scattered boolean env parsing
- **Current behavior:** `"0"`/`"false"` interpreted independently.
- **Risk:** Silent misconfig. **Impact:** Medium.
- **Minimal solution:** `RuntimeConfig` fail-fast.
- **Test:** invalid boolean throws.

### OH-012 SQLite without WAL on portal DB
- **Current behavior:** Default journal mode.
- **Risk:** Writer stalls / corruption under crash. **Impact:** Medium.
- **Minimal solution:** WAL + busy_timeout + foreign_keys.
- **Test:** store constructor pragmas (behavioral via lease tests).

### OH-013 Stale GIT_COMMIT_SHA pin
- **Current behavior:** Env pin could disagree with packaged code.
- **Risk:** False provenance. **Impact:** High.
- **Minimal solution:** `/api/version` prefers baked meta; deploy gate MAIN_SHA == DEPLOYED_SHA.
- **Test:** existing deploy-provenance tests.

### OH-014 Recovery suggested category compensation delete
- **Current behavior:** Persisted categories proposed `compensate`.
- **Risk:** Operator might auto-delete. **Impact:** High.
- **Minimal solution:** Recovery V2 `neverAutoDelete`, reuse persisted objects.
- **Test:** proposedAction continue + neverAutoDelete.

---

## Non-goals preserved

No Kubernetes, Kafka, Redis, microservices, Postgres migration, intelligence rewrite, Playwright replacement, Bella mutation, or weakening of approval.
