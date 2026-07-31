/**
 * Shared, framework-neutral agent-memory contracts for MAA (and Sales OS consumers).
 *
 * This package is the **shared contract surface** for experience / evaluation /
 * workflow-feedback / outcome / procedural / collector-snapshot shapes used across
 * the N1–N7 learning architecture. It has no Express, SQLite, or LLM dependencies.
 *
 * Import from `@maa/agent-memory-contracts` (not `@maa/contracts`) when you need
 * memory-domain Zod schemas and types only.
 *
 * @packageDocumentation
 */
export * from "./authority.js";
export * from "./scope.js";
export * from "./experience.js";
export * from "./evaluation.js";
export * from "./workflow-feedback.js";
export * from "./outcome.js";
export * from "./retrieval.js";
export * from "./gap-fingerprint.js";
export * from "./procedural.js";
export * from "./collector-snapshot.js";
