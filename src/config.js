import { parseNotificationUrls } from "./notify.js";

const DEFAULT_IMPORT_FROM = "1970-01-01";
const DEFAULT_CRON_EXPRESSION = "0 0 */4 * * *";

export function stringToBoolean(value) {
  switch (value?.toLowerCase().trim()) {
    case "true":
    case "yes":
    case "1":
      return true;
    case "false":
    case "no":
    case "0":
    case "":
    case undefined:
      return false;
    default:
      throw new Error(`Invalid boolean value: "${value}"`);
  }
}

function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
  }
}

/**
 * Builds { providerAccountId: actualAccountId } from PREFIX_ACCOUNT / PREFIX_ACTUAL_ACCOUNT
 * plus the numbered PREFIX_ACCOUNT_1 / PREFIX_ACTUAL_ACCOUNT_1, _2, ... pairs.
 */
export function collectAccountMapping(env, prefix) {
  requireEnv(env, [`${prefix}_ACCOUNT`, `${prefix}_ACTUAL_ACCOUNT`]);
  const mapping = { [env[`${prefix}_ACCOUNT`]]: env[`${prefix}_ACTUAL_ACCOUNT`] };

  for (let i = 1; ; i++) {
    const account = env[`${prefix}_ACCOUNT_${i}`];
    const actualAccount = env[`${prefix}_ACTUAL_ACCOUNT_${i}`];
    if (!account || !actualAccount) break;
    mapping[account] = actualAccount;
  }
  return mapping;
}

export function loadConfig(env = process.env) {
  const enableEdenred = stringToBoolean(env.ENABLE_EDENRED);
  const enableCoverflex = stringToBoolean(env.ENABLE_COVERFLEX);
  if (!enableEdenred && !enableCoverflex) {
    throw new Error("Both meal card importers are disabled");
  }

  requireEnv(env, ["ACTUAL_SERVER_URL", "ACTUAL_SERVER_PASSWORD", "ACTUAL_SYNC_ID"]);

  const config = {
    actual: {
      serverURL: env.ACTUAL_SERVER_URL,
      password: env.ACTUAL_SERVER_PASSWORD,
      filePassword: env.ACTUAL_FILE_PASSWORD || "",
      syncId: env.ACTUAL_SYNC_ID,
      dataDir: env.ACTUAL_DATA_DIR || "./temp_data_actual",
    },
    cronExpression: env.CRON_EXPRESSION || DEFAULT_CRON_EXPRESSION,
    runOnStart: stringToBoolean(env.RUN_ON_START),
    notifications: parseNotificationUrls(env.NOTIFICATION_URL),
    edenred: null,
    coverflex: null,
  };

  if (enableEdenred) {
    requireEnv(env, ["EDENRED_USERNAME", "EDENRED_PIN"]);
    config.edenred = {
      username: env.EDENRED_USERNAME,
      pin: env.EDENRED_PIN,
      version: env.EDENRED_VERSION || "4.1.0",
      importFrom: env.EDENRED_IMPORT_FROM || DEFAULT_IMPORT_FROM,
      accounts: collectAccountMapping(env, "EDENRED"),
    };
  }

  if (enableCoverflex) {
    requireEnv(env, ["COVERFLEX_USERNAME", "COVERFLEX_PASSWORD"]);
    config.coverflex = {
      username: env.COVERFLEX_USERNAME,
      password: env.COVERFLEX_PASSWORD,
      userAgentToken: env.COVERFLEX_USER_AGENT_TOKEN || "",
      // IMPORT_FROM was read by mistake in older versions; kept as a fallback.
      importFrom: env.COVERFLEX_IMPORT_FROM || env.IMPORT_FROM || DEFAULT_IMPORT_FROM,
      accounts: collectAccountMapping(env, "COVERFLEX"),
    };
  }

  return config;
}

/** Loads .env into process.env when present (Node's built-in replacement for dotenv). */
export function loadEnvFile(path = ".env") {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
