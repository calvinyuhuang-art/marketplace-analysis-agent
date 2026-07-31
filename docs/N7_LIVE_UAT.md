# N7 Live DeepSeek UAT Checklist

**Status:** Manual only — **not** part of CI  
**Service target:** `0.17.0` · schema `0014`  
**Provider:** DeepSeek (live) via configured model profile  
**Cap:** keep runs short; stop if spend/time exceeds team budget

---

## Preconditions

- [ ] Local MAA running (`pnpm migrate` + `pnpm dev`) with DeepSeek credentials
- [ ] `GET /health` returns `"version":"0.17.0"`
- [ ] Fixture evidence packages available (`completeKdpFixture` / console upload)
- [ ] Operator notes cost ceiling and max wall-clock before starting

---

## Cap rules (hard)

| Limit | Suggested default |
|---|---|
| Max live analysis runs | ≤ 5 |
| Max reassess / revise follow-ups | ≤ 2 |
| Abort | On provider errors, runaway loops, or budget breach |

---

## Checklist

### A. Smoke (mock first, then one live)

1. [ ] Mock-only `full_marketplace_analysis` completes (baseline sanity)
2. [ ] Switch profile to DeepSeek; one `full_marketplace_analysis` reaches terminal status
3. [ ] Confirm experience row + evaluation dual-write still present for the live run

### B. N2–N5 surfaces (spot-check, not full matrix)

4. [ ] Evidence plan create + review path works against live readiness gaps (if triggered)
5. [ ] Workflow feedback appears when late gap is induced (optional; skip if no gap)
6. [ ] Typed procedural activation still blocks known unsafe readiness (fixture case)
7. [ ] Outcome ingest + `reassess_with_outcome` once (capped)

### C. N6 comparative

8. [ ] `comparative_analysis` with two same-capability packages completes once live
9. [ ] Cross-capability packages still rejected before model (`UNSUPPORTED_CAPABILITY`)

### D. N7 removal

10. [ ] `POST /v1/analysis-requests` with `operation: propose_memory_update` → `422 UNSUPPORTED_OPERATION`
11. [ ] `GET /v1/capabilities` does **not** list `propose_memory_update` even with `X-Maa-Allow-Deprecated`
12. [ ] Memory proposal still works via `POST /v1/memory-proposals`

### E. Ops

13. [ ] Admin backup creates `maa-backup.v1` with `databaseSchemaVersion: "0014"`
14. [ ] Restore smoke on a throwaway copy succeeds

---

## Record

| Field | Value |
|---|---|
| Date | |
| Operator | |
| DeepSeek model | |
| Runs executed | |
| Failures / notes | |
| Stopped early? | yes / no |

---

## Explicit non-goals

- Full combinatorial capability matrix
- Cloud / SSO
- Embedding / fine-tuning experiments
- CI automation of this checklist
