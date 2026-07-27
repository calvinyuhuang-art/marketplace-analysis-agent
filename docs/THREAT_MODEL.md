# Threat Model (local-first V1)

**Scope:** Marketplace Analysis Agent running as a local service on a trusted operator machine or private LAN.  
**Out of scope:** Cloud multi-tenancy, enterprise SSO/OIDC, public internet exposure.

## Assets

| Asset | Sensitivity |
|---|---|
| SQLite database (projects, findings, memory, wiki) | High — commercial intelligence |
| Artifact store (prompts, model I/O, evidence copies) | High |
| `DEEPSEEK_API_KEY` / `MAA_API_KEY` | Secret |
| Audit / access logs | Medium — may contain correlation IDs and paths |
| Operator console | Medium — same trust boundary as API |

## Trust boundaries

1. **Operator workstation** — full trust for local DB/files.
2. **HTTP API** (`127.0.0.1` by default) — untrusted clients unless `MAA_API_KEY` is set.
3. **Upstream Research Team** — trusted to supply evidence packages; must not write MAA SQLite.
4. **Model provider (DeepSeek)** — untrusted with secrets; prompts must not leak API keys; evidence may leave the host when live models are enabled.

## Threats and mitigations (M10)

| Threat | Mitigation |
|---|---|
| Unauthorized API use on shared host | Local bearer / `x-api-key`; production requires auth |
| Path traversal in artifacts | `resolveSafePath` — user input never chooses paths |
| Secret leakage in logs | `SECRET_CONFIG_KEYS` redaction; never log raw API keys |
| Prompt injection in evidence | Evidence is data; quality gates + inert storage |
| DB corruption / bit rot | `PRAGMA integrity_check` via CLI/admin |
| Accidental data loss | Local backup/export (`pnpm maa backup`) |
| Artifact disk growth | Retention purge (`MAA_ARTIFACT_RETENTION_DAYS` + CLI) |
| MAA failure corrupting Research Team | Client adapter preserves accepted RT artifacts |
| Free-chat / unconstrained agent | Operation allow-list; capability packs |

## Residual risks

- Binding to `0.0.0.0` without a key exposes the API on the LAN.
- Live LLM sends evidence-derived content to a third party.
- Backup folders on disk are not encrypted at rest.
- Restore is destructive; operators must stop the service before restore.

## Deferred (requires separate design)

- External/enterprise authentication
- Cloud deployment and multi-tenancy
- Encrypted backups / KMS
