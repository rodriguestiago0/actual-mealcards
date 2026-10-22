import cron from "node-cron";
import { loadConfig, loadEnvFile } from "./src/config.js";
import { runEnabledImports, whenIdle } from "./src/engine.js";
import { log, silenceLibraryLogs } from "./src/log.js";

loadEnvFile();
silenceLibraryLogs();
const config = loadConfig();

if (!cron.validate(config.cronExpression)) {
  throw new Error(`Invalid cron expression: "${config.cronExpression}"`);
}
if (config.edenred) log.info("My Edenred import enabled");
if (config.coverflex) log.info("Coverflex import enabled");
if (config.notifications.length > 0) {
  log.info(`Notifications: ${config.notifications.map((channel) => channel.name).join(", ")}`);
}

const task = cron.schedule(
  config.cronExpression,
  async () => {
    await runEnabledImports(config);
    log.info("Next run:", task.getNextRun()?.toISOString());
  },
  { noOverlap: true },
);
log.info(`Scheduled (${config.cronExpression}), next run:`, task.getNextRun()?.toISOString());

// Registered before the first import: as PID 1 in Docker, Node ignores signals it has no handler
// for. A running import is allowed to finish so its changes are synced.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    log.info(`Received ${signal}, stopping`);
    await task.stop();
    await whenIdle();
    process.exit(0);
  });
}

if (config.runOnStart) await runEnabledImports(config);
