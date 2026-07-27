/**
 * Local ops CLI: integrity | backup | restore | retention | release-check
 * Usage: pnpm maa <command> [...args]
 */
import { resolve } from "node:path";
import {
  checkDatabaseIntegrity,
  createBackup,
  purgeExpiredArtifacts,
  restoreBackup
} from "@maa/ops";
import { Database } from "@maa/database";
import { loadConfig } from "./config/index";
import { SERVICE_VERSION } from "./composition/container";

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const config = loadConfig();

  switch (cmd) {
    case "integrity": {
      const db = Database.open({ path: config.databasePath });
      try {
        const result = checkDatabaseIntegrity(db.db);
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.ok ? 0 : 2);
      } finally {
        db.close();
      }
      break;
    }
    case "backup": {
      const includeArtifacts = args.includes("--artifacts");
      const result = createBackup({
        databasePath: config.databasePath,
        backupDir: config.backupDir,
        serviceVersion: SERVICE_VERSION,
        includeArtifacts,
        artifactRoot: config.artifactRoot,
        notes: "cli"
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "restore": {
      const backupPath = args.find((a) => !a.startsWith("--"));
      if (!backupPath) {
        console.error("Usage: pnpm maa restore <backupPath> [--artifacts]");
        process.exit(1);
      }
      const manifest = restoreBackup({
        backupPath: resolve(backupPath),
        databasePath: config.databasePath,
        restoreArtifacts: args.includes("--artifacts"),
        artifactRoot: config.artifactRoot
      });
      console.log(JSON.stringify({ ok: true, manifest }, null, 2));
      break;
    }
    case "retention": {
      const dryRun = !args.includes("--execute");
      const daysArg = args.find((a) => a.startsWith("--days="));
      const retentionDays = daysArg
        ? Number(daysArg.split("=")[1])
        : config.raw.MAA_ARTIFACT_RETENTION_DAYS;
      const result = purgeExpiredArtifacts({
        artifactRoot: config.artifactRoot,
        retentionDays,
        dryRun
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "release-check": {
      console.log(
        JSON.stringify(
          {
            serviceVersion: SERVICE_VERSION,
            profile: config.raw.MAA_CONFIG_PROFILE,
            authRequired:
              config.raw.MAA_REQUIRE_API_KEY || config.raw.MAA_API_KEY.trim().length > 0,
            databasePath: config.databasePath,
            ok: true
          },
          null,
          2
        )
      );
      break;
    }
    default:
      console.error(
        "Usage: pnpm maa <integrity|backup|restore|retention|release-check> [options]"
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
