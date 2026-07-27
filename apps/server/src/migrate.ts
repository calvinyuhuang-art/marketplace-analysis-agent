import { Database, runMigrations } from "@maa/database";
import { loadConfig } from "./config/index";

function main(): void {
  const config = loadConfig();
  const database = Database.open({ path: config.databasePath });
  try {
    const result = runMigrations(database.db, config.migrationsDir);
    if (result.applied.length === 0) {
      console.log("Migrations up to date. Nothing to apply.");
    } else {
      console.log(`Applied ${result.applied.length} migration(s):`);
      for (const name of result.applied) console.log(`  - ${name}`);
    }
  } finally {
    database.close();
  }
}

main();
