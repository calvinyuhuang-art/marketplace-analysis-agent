import { defineWorkspace } from "vitest/config";
import { resolve } from "node:path";

const alias = {
  "@maa/contracts": resolve("packages/contracts/src/index.ts"),
  "@maa/logging": resolve("packages/logging/src/index.ts"),
  "@maa/artifacts": resolve("packages/artifacts/src/index.ts"),
  "@maa/database": resolve("packages/database/src/index.ts"),
  "@maa/audit": resolve("packages/audit/src/index.ts"),
  "@maa/model-router": resolve("packages/model-router/src/index.ts"),
  "@maa/agent-core": resolve("packages/agent-core/src/index.ts"),
  "@maa/evidence": resolve("packages/evidence/src/index.ts"),
  "@maa/capability-amazon-kdp": resolve("packages/capability-amazon-kdp/src/index.ts"),
  "@maa/analysis": resolve("packages/analysis/src/index.ts"),
  "@maa/memory": resolve("packages/memory/src/index.ts"),
  "@maa/learning": resolve("packages/learning/src/index.ts"),
  "@maa/wiki": resolve("packages/wiki/src/index.ts"),
  "@maa/quality": resolve("packages/quality/src/index.ts"),
  "@maa/client": resolve("packages/client/src/index.ts"),
  "@maa/ops": resolve("packages/ops/src/index.ts")
};

export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: "unit",
      include: ["packages/**/*.test.ts"],
      environment: "node"
    }
  },
  {
    resolve: { alias },
    test: {
      name: "api",
      include: ["apps/server/**/*.test.ts"],
      environment: "node"
    }
  }
]);
