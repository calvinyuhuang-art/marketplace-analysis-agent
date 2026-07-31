# Vendored Learning Plane packages

Exact packed artifacts from Learning Plane `pnpm package:consumer`.

## Artifacts (LP8-I3b)

| Package | Version | Artifact |
|---|---|---|
| `@learning-plane/contracts` | `0.8.0` | `artifacts/learning-plane-contracts-0.8.0.tgz` |
| `@learning-plane/client` | `0.8.0` | `artifacts/learning-plane-client-0.8.0.tgz` |

Authoritative SHA-256 checksums: `COMPATIBILITY_MANIFEST.json` in this directory.

Expected checksums:

```text
contracts: 51e00046e8fd715f93997108863f0813c8bdc2ac5c8a2cd27d80009da3d62e86
client:    2fb12a37621d5b361ea32634b972e9a978d06675d9a309dbd0ec38a05f560a49
```

## Reproduce on another workstation

From Learning Plane root:

```bash
pnpm package:consumer
```

Copy the two `.tgz` files and `COMPATIBILITY_MANIFEST.json` into this directory, then from MAA root:

```bash
pnpm add ./vendor/learning-plane/artifacts/learning-plane-contracts-0.8.0.tgz --filter @maa/server
pnpm add ./vendor/learning-plane/artifacts/learning-plane-client-0.8.0.tgz --filter @maa/server
pnpm install
```

Do not copy Learning Plane server source.
