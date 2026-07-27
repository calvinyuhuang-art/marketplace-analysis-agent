import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/migrate.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle internal workspace packages; keep native/runtime deps external.
  noExternal: [/^@maa\//],
  external: ["better-sqlite3"],
  splitting: false,
  dts: false
});
