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

/** Imports every Edenred card into the open budget, returning the per-card failures. */
async function importEdenredInto(api, config, token) {
  const failures = accountFailures("Edenred");
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
  return failures;
}

/** Imports every Coverflex pocket into the open budget, returning the per-pocket failures. */
async function importCoverflexInto(api, config, token) {
  const failures = accountFailures("Coverflex");
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
        const errors = await importTransactions(api, actualAccount, transactions, config.actual);
        if (errors.length > 0) failures.rejected(actualAccount);
        await updateChangedTransactions(
          api,
          actualAccount,
          transactions,
          config.coverflex.importFrom,
        );
      }
      if (cancelledIds.length > 0) {
        await deleteByImportedIds(api, actualAccount, cancelledIds, config.coverflex.importFrom);
      }
    });
  }
  return failures;
}

/** Logs in, then opens the budget, imports and syncs; account failures are thrown after. */
async function importAlone(provider, config, budgetApi) {
  const session = await provider.prepare(config);
  const failures = await withBudget(
    config.actual,
    (api) => provider.importInto(api, config, session),
    budgetApi,
  );
  failures.throwIfAny();
}

export const importEdenred = (config, budgetApi) => importAlone(imports.Edenred, config, budgetApi);
export const importCoverflex = (config, budgetApi) =>
  importAlone(imports.Coverflex, config, budgetApi);

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

/**
 * The importers, in the order they run. prepare logs in (before the budget is opened, so a login
 * failure costs no download), and importInto imports into the open budget, returning failures to
 * throw once it synced. run imports on its own, as the CLI does.
 */
export const imports = {
  Edenred: {
    enabled: (config) => config.edenred,
    prepare: (config) => edenred.login(config.edenred),
    importInto: importEdenredInto,
    run: (config, budgetApi) => importEdenred(config, budgetApi),
  },
  Coverflex: {
    enabled: (config) => config.coverflex,
    prepare: async (config) => {
      await checkCoverflexTokenExpiry(config);
      return coverflex.login(config.coverflex);
    },
    importInto: importCoverflexInto,
    run: (config, budgetApi) => importCoverflex(config, budgetApi),
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

// Imports whose last run failed, so the next successful run can be reported as a recovery.
const failing = new Set();

/**
 * Runs every enabled import in one budget session; failures and recoveries are logged and notified.
 */
export function runEnabledImports(config, registry = imports, budgetApi) {
  return runExclusive(async () => {
    const enabled = Object.entries(registry).filter(([, provider]) => provider.enabled(config));
    const errors = new Map();
    const ready = [];
    for (const [name, provider] of enabled) {
      log.info(`Importing ${name}`);
      try {
        ready.push({ name, provider, session: await provider.prepare(config) });
      } catch (err) {
        errors.set(name, err);
      }
    }

    if (ready.length > 0) {
      const results = [];
      try {
        await withBudget(
          config.actual,
          async (api) => {
            for (const { name, provider, session } of ready) {
              try {
                results.push([name, await provider.importInto(api, config, session)]);
              } catch (err) {
                errors.set(name, err);
              }
            }
          },
          budgetApi,
        );
        for (const [name, failures] of results) {
          try {
            failures.throwIfAny();
          } catch (err) {
            errors.set(name, err);
          }
        }
      } catch (err) {
        // Opening or syncing the budget failed, so every import that got that far did.
        for (const { name } of ready) if (!errors.has(name)) errors.set(name, err);
      }
    }

    for (const [name] of enabled) {
      const err = errors.get(name);
      if (!err) {
        if (failing.delete(name)) {
          log.info(`${name} import recovered`);
          await notify(config.notifications, `✅ actual-mealcards: ${name} recovered`);
        }
        continue;
      }
      failing.add(name);
      log.error(`${name} import failed:`, err);
      await notify(
        config.notifications,
        `❌ actual-mealcards: ${name} import failed\n${err.message}`,
      );
    }
    return errors.size === 0;
  });
}
