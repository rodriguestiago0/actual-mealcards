#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { loadConfig, loadEnvFile } from "./src/config.js";
import { imports } from "./src/engine.js";
import { silenceLibraryLogs } from "./src/log.js";
import { getUserAgentToken } from "./src/providers/coverflex.js";

const USAGE = `
  Usage
    $ mealcards <command>

  Commands
    import-myedenred     Sync My Edenred accounts to Actual Budget
    import-coverflex     Sync Coverflex accounts to Actual Budget
    get-coverflex-token  Log in to Coverflex with an OTP and print the user agent token

  Options
    -h, --help           Show this help
`;

async function askOtp() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question("Enter your OTP code: ")).trim();
  } finally {
    rl.close();
  }
}

function requireProvider(config, name) {
  if (!config[name]) throw new Error(`${name} import is not enabled`);
}

const commands = {
  "import-myedenred": async (config) => {
    requireProvider(config, "edenred");
    await imports.Edenred.run(config);
  },
  "import-coverflex": async (config) => {
    requireProvider(config, "coverflex");
    await imports.Coverflex.run(config);
  },
  "get-coverflex-token": async (config) => {
    requireProvider(config, "coverflex");
    const token = await getUserAgentToken(config.coverflex, askOtp);
    process.stdout.write(`Your COVERFLEX_USER_AGENT_TOKEN is: ${token}\n`);
  },
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { help: { type: "boolean", short: "h" } },
});
const [command] = positionals;

if (values.help || !command) {
  console.log(USAGE);
  process.exit(command || values.help ? 0 : 1);
}
if (!commands[command]) {
  console.error(`Unknown command: ${command}\n${USAGE}`);
  process.exit(1);
}

try {
  loadEnvFile();
  silenceLibraryLogs();
  await commands[command](loadConfig());
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
