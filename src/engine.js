import { deleteByImportedIds, importTransactions, withBudget } from "./actual.js";
import { log } from "./log.js";
import { notify } from "./notify.js";
import * as coverflex from "./providers/coverflex.js";
import * as edenred from "./providers/edenred.js";

const TOKEN_EXPIRY_WARNING_DAYS = 30;

export async function importEdenred(config) {
  await withBudget(config.actual, async (api) => {
    for (const [edenredAccount, actualAccount] of Object.entries(config.edenred.accounts)) {
      log.info(`Importing Edenred account ${edenredAccount}`);
      const transactions = await edenred.getTransactions(config.edenred, edenredAccount);
      if (transactions.length === 0) {
        log.info("No transactions to import");
        continue;
      }
      await importTransactions(api, actualAccount, transactions);
    }
  });
}

export async function importCoverflex(config) {
  await withBudget(config.actual, async (api) => {
    for (const [pocketId, actualAccount] of Object.entries(config.coverflex.accounts)) {
      log.info(`Importing Coverflex pocket ${pocketId}`);
      const { transactions, cancelledIds } = await coverflex.getTransactions(
        config.coverflex,
        pocketId,
      );
      if (transactions.length === 0) {
        log.info("No transactions to import");
      } else {
        await importTransactions(api, actualAccount, transactions);
      }
      if (cancelledIds.length > 0) {
        await deleteByImportedIds(api, actualAccount, cancelledIds, config.coverflex.importFrom);
      }
    }
  });
}

let lastExpiryWarning = null;

/** Warns (at most once a day) when the Coverflex user agent token is about to expire. */
export async function checkCoverflexTokenExpiry(config, now = new Date()) {
  const expiresAt = coverflex.tokenExpiry(config.coverflex.userAgentToken);
  if (!expiresAt) return;

  const daysLeft = Math.floor((expiresAt - now) / 86_400_000);
  const today = now.toISOString().slice(0, 10);
  if (daysLeft > TOKEN_EXPIRY_WARNING_DAYS || lastExpiryWarning === today) return;

  lastExpiryWarning = today;
  const message =
    daysLeft < 0
      ? "Coverflex user agent token has expired"
      : `Coverflex user agent token expires in ${daysLeft} day(s)`;
  log.warn(`${message}; run \`mealcards get-coverflex-token\` to renew it`);
  await notify(config.notifications, `⚠️ actual-mealcards: ${message}. Run get-coverflex-token.`);
}

export const imports = {
  Edenred: { enabled: (config) => config.edenred, run: importEdenred },
  Coverflex: {
    enabled: (config) => config.coverflex,
    run: async (config) => {
      await checkCoverflexTokenExpiry(config);
      await importCoverflex(config);
    },
  },
};

// The Actual API holds a single open budget, so runs must never overlap
// (e.g. RUN_ON_START still running when the first cron tick fires).
let queue = Promise.resolve();
function runExclusive(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

/** Runs every enabled import; failures are logged and notified. */
export function runEnabledImports(config, registry = imports) {
  return runExclusive(async () => {
    let ok = true;
    for (const [name, provider] of Object.entries(registry)) {
      if (!provider.enabled(config)) continue;
      log.info(`Importing ${name}`);
      try {
        await provider.run(config);
      } catch (err) {
        ok = false;
        log.error(`${name} import failed:`, err);
        await notify(
          config.notifications,
          `❌ actual-mealcards: ${name} import failed\n${err.message}`,
        );
      }
    }
    return ok;
  });
}
