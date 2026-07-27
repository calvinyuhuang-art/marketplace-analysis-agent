import { createApp } from "./app";
import { loadConfig } from "./config/index";
import { createContainer } from "./composition/container";

async function main(): Promise<void> {
  const config = loadConfig();
  const container = createContainer(config);
  const app = createApp(container);

  const server = app.listen(config.raw.MAA_PORT, config.raw.MAA_HOST, () => {
    container.loggers.application.info(
      {
        eventType: "server_started",
        host: config.raw.MAA_HOST,
        port: config.raw.MAA_PORT,
        instanceId: container.instanceId
      },
      `MAA server listening on http://${config.raw.MAA_HOST}:${config.raw.MAA_PORT}`
    );
  });

  const shutdown = (signal: string) => {
    container.loggers.application.info({ eventType: "server_stopping", signal }, "shutting down");
    server.close(() => {
      void container.shutdown().then(() => process.exit(0));
    });
    // Force exit if graceful close hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
