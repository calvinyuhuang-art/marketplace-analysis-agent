# Changelog

## 0.10.0 — M10 Hardening and Publishability Preparation

- Local API authentication (`MAA_API_KEY`, Bearer / `x-api-key`)
- Configuration profiles (`development`, `test`, `local-hardened`)
- Admin/ops: integrity check, backup, restore, artifact retention
- CLI: `pnpm maa <integrity|backup|restore|retention|release-check>`
- Expanded `/metrics` (latency percentiles, auth flags, HTTP counters)
- Threat model documentation and API compatibility tests
- Production refuses to start without local API auth

## 0.9.0 — M9 Research Team Integration

- `@maa/client` typed HTTP client and Research Team adapter

## 0.8.0 — M8 Governed Wiki

- Memory-backed wiki compiler, lint, versioned patches
