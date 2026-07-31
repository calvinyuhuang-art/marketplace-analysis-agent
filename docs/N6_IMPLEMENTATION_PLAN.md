# N6 Implementation Plan — Comparative Analysis + Integration Polish

**Status:** Accepted (continue after N5)  
**Depends on:** N1–N5 APIs stable  
**Service target:** `0.16.0` · schema `0014`

---

## 1. Objective

Ship a real **`comparative_analysis`** workflow (baseline vs compare evidence packages within one capability). Finish RT **`@maa/client`** surface for plans / feedback / outcomes / comparative helpers. Move `propose_memory_update` to **Hide** stage (omit from capability advertisement unless `X-Maa-Allow-Deprecated: propose_memory_update`). Update Sales OS integration docs.

---

## 2. Explicit non-goals

- N7 public removal of `propose_memory_update` from OperationType
- New marketplaces / capability packs
- Cloud multi-tenancy

---

## 3. Comparative analysis

### Request shape

| Field | Role |
|---|---|
| `operation` | `comparative_analysis` |
| `evidencePackageIds` | Compare / current side (≥1) |
| `baselineEvidencePackageIds` | Baseline side (≥1, required for this op) |
| `capability` | Must match package coordinates |

### Guards (before model)

1. Packages exist.
2. Each package’s `platform/marketplace/category/productType` matches request capability → else `UNSUPPORTED_CAPABILITY` (no model call).
3. Baseline and compare sets linked on the request; baseline IDs persisted.

### Runtime

Deterministic fixture `analysis.v1.comparative` emits findings that contrast baseline vs compare (counts, prices) with tags `comparative_baseline` / `comparative_compare`.

---

## 4. Deprecation Hide (`propose_memory_update`)

| Surface | Behavior |
|---|---|
| `GET /v1/capabilities` | Omit op unless `X-Maa-Allow-Deprecated: propose_memory_update` |
| `POST /v1/analysis-requests` | Still accepted (Warn headers remain); removal in N7 |
| Examples / docs | Prefer `/v1/memory-proposals` |

---

## 5. Client

Add typed methods: capabilities, evidence plans/snapshots/reviews, workflow feedback resolve, outcomes ingest/reassess, `createComparativeAnalysis` helper.

---

## 6. Tests

1. Comparative happy path → completed + comparative findings.
2. Cross-capability package → reject, no model call.
3. Capabilities hide deprecated op by default; header restores it.
4. Client method smoke / contract parse.
5. Gates green.

---

## 7. Acceptance

N6 exit: comparative works within capability; client covers N2–N5 surfaces; deprecated op hidden from advertisement.
