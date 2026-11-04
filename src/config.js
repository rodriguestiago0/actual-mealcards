import { log } from "./log.js";
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

/** The YYYY-MM-DD in env[name], or the default; a malformed date would silently misfilter. */
function importFrom(env, name) {
  const value = env[name] || DEFAULT_IMPORT_FROM;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${name} must be a date as YYYY-MM-DD, got "${value}"`);
  }
  return value;
}

function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
  }
}

/**
 * Builds { providerAccountId: actualAccountId } from PREFIX_ACCOUNT / PREFIX_ACTUAL_ACCOUNT
 * plus the numbered PREFIX_ACCOUNT_1 / PREFIX_ACTUAL_ACCOUNT_1, _2, ... pairs. Numbering stops at
 * the first incomplete pair, with a warning when that drops variables that are set.
 */
export function collectAccountMapping(env, prefix) {
  requireEnv(env, [`${prefix}_ACCOUNT`, `${prefix}_ACTUAL_ACCOUNT`]);
  const mapping = { [env[`${prefix}_ACCOUNT`]]: env[`${prefix}_ACTUAL_ACCOUNT`] };

  let i = 1;
  for (; ; i++) {
    const account = env[`${prefix}_ACCOUNT_${i}`];
    const actualAccount = env[`${prefix}_ACTUAL_ACCOUNT_${i}`];
    if (!account || !actualAccount) break;
    if (Object.hasOwn(mapping, account)) {
      log.warn(`${prefix}_ACCOUNT_${i} repeats account "${account}"; using the last mapping`);
    }
    mapping[account] = actualAccount;
  }

  const pattern = new RegExp(`^${prefix}_(?:ACTUAL_)?ACCOUNT_(\\d+)$`);
  const ignored = Object.keys(env)
    .filter((name) => env[name] && Number(pattern.exec(name)?.[1]) >= i)
    .sort();
  if (ignored.length > 0) {
    log.warn(
      `Ignoring ${ignored.join(", ")}: ${prefix}_ACCOUNT_${i} and ${prefix}_ACTUAL_ACCOUNT_${i} ` +
        "aren't both set, and numbering stops at the first incomplete pair",
    );
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
      reimportDeleted: stringToBoolean(env.REIMPORT_DELETED),
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
      importFrom: importFrom(env, "EDENRED_IMPORT_FROM"),
      accounts: collectAccountMapping(env, "EDENRED"),
    };
  }

  if (enableCoverflex) {
    requireEnv(env, ["COVERFLEX_USERNAME", "COVERFLEX_PASSWORD"]);
    config.coverflex = {
      username: env.COVERFLEX_USERNAME,
      password: env.COVERFLEX_PASSWORD,
      userAgentToken: env.COVERFLEX_USER_AGENT_TOKEN || "",
      importFrom: importFrom(env, "COVERFLEX_IMPORT_FROM"),
      accounts: collectAccountMapping(env, "COVERFLEX"),
    };
  }

  return config;
}

/** The Coverflex credentials alone, for get-coverflex-token, which doesn't touch Actual. */
export function loadCoverflexCredentials(env = process.env) {
  requireEnv(env, ["COVERFLEX_USERNAME", "COVERFLEX_PASSWORD"]);
  return { username: env.COVERFLEX_USERNAME, password: env.COVERFLEX_PASSWORD };
}

/** Loads .env into process.env when present (Node's built-in replacement for dotenv). */
export function loadEnvFile(path = ".env") {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
