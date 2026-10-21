import cron from "node-cron";
import { loadConfig, loadEnvFile } from "./src/config.js";
import { runEnabledImports } from "./src/engine.js";

loadEnvFile();
const config = loadConfig();

console.info("Cron expression:", config.cronExpression);
if (config.edenred) console.info("My Edenred import enabled");
if (config.coverflex) console.info("Coverflex import enabled");

const task = cron.schedule(
  config.cronExpression,
  async () => {
    await runEnabledImports(config);
    console.info("Next run:", task.getNextRun()?.toISOString());
  },
  { noOverlap: true },
);
console.info("Next run:", task.getNextRun()?.toISOString());

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    console.info(`Received ${signal}, stopping`);
    await task.stop();
    process.exit(0);
  });
}
