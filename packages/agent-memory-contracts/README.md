# @maa/agent-memory-contracts

Framework-neutral Zod schemas and TypeScript types for MAA’s learning /
memory architecture (N1–N7).

## What this package is

The shared contract surface for:

- Experiences and evaluations
- Workflow feedback / gap fingerprints
- Outcome events
- Typed procedural rule versions
- Collector capability snapshots
- Retrieval / authority / scope helpers

It intentionally has **no** Express, SQLite, or model-provider dependencies.

## What this package is not

- Not the HTTP API surface (`@maa/contracts` + `@maa/client`)
- Not persistence or services (`@maa/database`, `@maa/learning`)

## Usage

```ts
import {
  ExperienceSchema,
  EvaluationSchema
} from "@maa/agent-memory-contracts";
```

Prefer this package when Sales OS (or another consumer) needs memory-domain
shapes without pulling the full MAA server contract set.
