import {
  deleteByImportedIds,
  importTransactions,
  requireOpenAccounts,
  updateChangedTransactions,
  withBudget,
} from "./actual.js";
import { log } from "./log.js";
import { notify } from "./notify.js";
import * as coverflex from "./providers/coverflex.js";
import * as edenred from "./providers/edenred.js";

const TOKEN_EXPIRY_WARNING_DAYS = 30;

/**
 * Collects per-account problems, so one failing account doesn't stop the others, and throws them
 * together once the budget has synced.
 */
function accountFailures(provider) {
  const failures = [];
  // Actual rejects an account's whole batch when one transaction is invalid.
  const rejected = [];
  return {
    async run(account, fn) {
      try {
        await fn();
      } catch (err) {
        log.error(`${provider} account ${account} failed:`, err);
        failures.push(`${account}: ${err.message}`);
      }
    },
    skipped(account, descriptions) {
      if (descriptions.length === 0) return;
      log.warn(`${provider} account ${account}: skipped malformed movement(s):`, descriptions);
      failures.push(`${account}: skipped ${descriptions.length} malformed movement(s)`);
    },
    rejected(actualAccount) {
      rejected.push(actualAccount);
    },
    throwIfAny() {
      const lines = failures.map((failure) => `${provider} ${failure}`);
      if (rejected.length > 0) {
        lines.push(`Actual reported import errors for account(s): ${rejected.join(", ")}`);
      }
      if (lines.length > 0) throw new Error(lines.join("\n"));
    },
  };
}

export async function importEdenred(config, budgetApi) {
  const token = await edenred.login(config.edenred);
  const failures = accountFailures("Edenred");
  await withBudget(
    config.actual,
    async (api) => {
      await requireOpenAccounts(api, "Edenred", config.edenred.accounts);
      for (const [edenredAccount, actualAccount] of Object.entries(config.edenred.accounts)) {
        await failures.run(edenredAccount, async () => {
          log.info(`Importing Edenred account ${edenredAccount}`);
          const skipped = [];
          const transactions = await edenred.getTransactions(
            token,
            edenredAccount,
            config.edenred.importFrom,
            skipped,
          );
          failures.skipped(edenredAccount, skipped);
          if (transactions.length === 0) {
            log.info("No transactions to import");
            return;
          }
          const errors = await importTransactions(api, actualAccount, transactions, config.actual);
          if (errors.length > 0) failures.rejected(actualAccount);
        });
      }
    },
    budgetApi,
  );
  failures.throwIfAny();
}

export async function importCoverflex(config, budgetApi) {
  const token = await coverflex.login(config.coverflex);
  const failures = accountFailures("Coverflex");
  await withBudget(
    config.actual,
    async (api) => {
      await requireOpenAccounts(api, "Coverflex", config.coverflex.accounts);
      for (const [pocketId, actualAccount] of Object.entries(config.coverflex.accounts)) {
        await failures.run(pocketId, async () => {
          log.info(`Importing Coverflex pocket ${pocketId}`);
          const skipped = [];
          const { transactions, cancelledIds } = await coverflex.getTransactions(
            token,
            pocketId,
            config.coverflex.importFrom,
            skipped,
          );
          failures.skipped(pocketId, skipped);
          if (transactions.length === 0) {
            log.info("No transactions to import");
          } else {
            const errors = await importTransactions(
              api,
              actualAccount,
              transactions,
              config.actual,
            );
            if (errors.length > 0) failures.rejected(actualAccount);
            await updateChangedTransactions(
              api,
              actualAccount,
              transactions,
              config.coverflex.importFrom,
            );
          }
          if (cancelledIds.length > 0) {
            await deleteByImportedIds(
              api,
              actualAccount,
              cancelledIds,
              config.coverflex.importFrom,
            );
          }
        });
      }
    },
    budgetApi,
  );
  failures.throwIfAny();
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

/** Resolves once the running import, if any, has finished. */
export function whenIdle() {
  return queue;
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
