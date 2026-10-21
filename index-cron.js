import cron from "node-cron";
import { loadConfig, loadEnvFile } from "./src/config.js";
import { runEnabledImports } from "./src/engine.js";
import { log, silenceLibraryLogs } from "./src/log.js";

silenceLibraryLogs();
loadEnvFile();
const config = loadConfig();

if (!cron.validate(config.cronExpression)) {
  throw new Error(`Invalid cron expression: "${config.cronExpression}"`);
}
if (config.edenred) log.info("My Edenred import enabled");
if (config.coverflex) log.info("Coverflex import enabled");
if (config.telegram) log.info("Telegram notifications enabled");

const task = cron.schedule(
  config.cronExpression,
  async () => {
    await runEnabledImports(config);
    log.info("Next run:", task.getNextRun()?.toISOString());
  },
  { noOverlap: true },
);
log.info(`Scheduled (${config.cronExpression}), next run:`, task.getNextRun()?.toISOString());

if (config.runOnStart) await runEnabledImports(config);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    log.info(`Received ${signal}, stopping`);
    await task.stop();
    process.exit(0);
  });
}
