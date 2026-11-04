import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as actualApi from "@actual-app/api";
import { log } from "./log.js";

// API calls that only read, made as usual in a dry run.
const READS = /^(get|aqlQuery$|runQuery$|q$)/;

/**
 * The API with every call that would change the budget skipped and counted in `skipped`, except
 * importTransactions, which runs as Actual's preview so its result can still be logged. Its
 * `dryRun` is true, so helpers can say what would happen instead of what did.
 */
export function dryRunApi(api, skipped) {
  const wrap = (name, value) => {
    if (typeof value !== "function" || READS.test(name)) return value;
    if (name === "importTransactions") {
      return (accountId, transactions, opts) =>
        api.importTransactions(accountId, transactions, {
          defaultCleared: true,
          ...opts,
          dryRun: true,
        });
    }
    return async () => {
      skipped.set(name, (skipped.get(name) ?? 0) + 1);
    };
  };
  return {
    ...Object.fromEntries(Object.entries(api).map(([name, value]) => [name, wrap(name, value)])),
    dryRun: true,
  };
}

/**
 * Opens the budget, runs fn(api), then syncs and always shuts down, returning fn's result. In a
 * dry run, fn gets an API that can't change the budget, and nothing is synced.
 */
export async function withBudget(
  { serverURL, password, filePassword, syncId, dataDir, dryRun = false },
  fn,
  api = actualApi,
) {
  const budgetDir = join(dataDir, syncId);
  await mkdir(budgetDir, { recursive: true });

  try {
    await api.init({ serverURL, password, dataDir: budgetDir });
    await api.downloadBudget(syncId, filePassword ? { password: filePassword } : {});
  } catch (err) {
    await api.shutdown().catch(() => {});
    throw new Error(`Actual Budget error: ${err.message}`, { cause: err });
  }

  const skipped = new Map();
  let result;
  try {
    if (dryRun) {
      result = await fn(dryRunApi(api, skipped));
      const calls = [...skipped].map(([name, count]) => `${name} ×${count}`).join(", ");
      log.info(`Dry run: nothing was saved${calls ? ` (skipped ${calls})` : ""}`);
    } else {
      result = await fn(api);
      await api.sync();
    }
  } catch (err) {
    await api.shutdown().catch(() => {});
    throw err;
  }
  // The changes are synced by now, so a failing shutdown doesn't fail the import.
  await api.shutdown().catch((err) => log.warn("Actual shutdown failed after syncing:", err));
  return result;
}

/**
 * Throws unless every mapped Actual account is an open account in the budget. Actual imports into
 * an unknown id without an error, as transactions no account shows, again on every run.
 */
export async function requireOpenAccounts(api, provider, accounts) {
  const open = new Set(
    (await api.getAccounts()).filter((account) => !account.closed).map((account) => account.id),
  );
  const unknown = Object.entries(accounts).filter(([, actualAccount]) => !open.has(actualAccount));
  if (unknown.length > 0) {
    const list = unknown.map(([card, actualAccount]) => `"${actualAccount}" (for ${card})`);
    throw new Error(
      `${provider}: not an open account in this budget: ${list.join(", ")}. ` +
        "Check the *_ACTUAL_ACCOUNT variables",
    );
  }
}

/**
 * Imports transactions and returns the errors Actual reported, if any. Unless reimportDeleted is
 * set, a transaction the user deleted in Actual stays deleted: its imported_id still matches the
 * deleted row, so it is not added again. Payee names are title-cased, Actual's default, pinned so
 * an API update can't change it.
 */
export async function importTransactions(
  api,
  accountId,
  transactions,
  { reimportDeleted = false } = {},
) {
  log.debug("Transactions to import:", transactions);
  const result = await api.importTransactions(accountId, transactions, {
    reimportDeleted,
    payeeNameNormalization: "title-case",
  });
  log.info(
    `${api.dryRun ? "Would import" : "Imported"} into ${accountId}: ` +
      `${result.added.length} added, ${result.updated.length} updated`,
  );
  const errors = result.errors ?? [];
  if (errors.length > 0) log.error("Actual import errors:", errors);
  return errors;
}

/**
 * Applies amount and date changes to already-imported transactions, which Actual's import never
 * updates (e.g. a pending Coverflex movement confirmed at a different amount). Reconciled
 * transactions are left alone, like the import does, and so are split ones, whose parts would no
 * longer add up.
 */
export async function updateChangedTransactions(api, accountId, transactions, sinceDate) {
  const incoming = new Map(transactions.map((t) => [t.imported_id, t]));
  const until = transactions.reduce((max, t) => (t.date > max ? t.date : max), latestDate());
  const existing = await api.getTransactions(accountId, sinceDate, until);

  let updated = 0;
  for (const transaction of existing) {
    const wanted = incoming.get(transaction.imported_id);
    if (!wanted || transaction.reconciled) continue;
    const changes = {};
    if (transaction.amount !== wanted.amount) changes.amount = wanted.amount;
    if (transaction.date !== wanted.date) changes.date = wanted.date;
    if (Object.keys(changes).length === 0) continue;
    if (transaction.is_parent) {
      log.warn(`Not updating split transaction ${transaction.id}: its amount or date changed`);
      continue;
    }
    await api.updateTransaction(transaction.id, changes);
    updated++;
  }
  if (updated > 0) {
    const verb = api.dryRun ? "Would update" : "Updated";
    log.info(`${verb} amount or date of ${updated} transaction(s) in ${accountId}`);
  }
}

/**
/**
 * Deletes the Actual transactions whose imported_id is in importedIds, except reconciled ones:
 * deleting those would change a reconciled balance, so they are only reported. The API's
 * deleteTransaction resolves before the delete is applied (api/transaction-delete doesn't await
 * the batch update), so each delete is waited for: otherwise sync() runs without it and only a
 * fixed sleep in shutdown() keeps it from being lost.
 */
export async function deleteByImportedIds(
  api,
  accountId,
  importedIds,
  sinceDate,
  { timeoutMs = 5000 } = {},
) {
  const wanted = new Set(importedIds);
  const existing = await api.getTransactions(accountId, sinceDate, latestDate());
  const matches = existing.filter((t) => wanted.has(t.imported_id));
  const describe = (t) =>
    [t.date, (t.amount / 100).toFixed(2), t.imported_payee].filter(Boolean).join(" ");

  for (const transaction of matches) {
    if (transaction.reconciled) {
      log.warn(
        `Not deleting reconciled transaction ${describe(transaction)} in ${accountId}: ` +
          "it was cancelled; delete it in Actual if you want it gone",
      );
      continue;
    }
    await api.deleteTransaction(transaction.id);
    // A dry run skips the delete, so there is nothing to wait for.
    if (!api.dryRun) await waitUntilDeleted(api, accountId, transaction, timeoutMs);
    const verb = api.dryRun ? "Would delete" : "Deleted";
    log.info(`${verb} cancelled transaction ${describe(transaction)} from ${accountId}`);
  }
}

/** YYYY-MM-DD in local time. */
export function formatDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The latest date an imported transaction can have: tomorrow in local time, so transactions that
 * earlier versions dated by the UTC day, which can be ahead of the local one, are still found.
 */
function latestDate() {
  return formatDate(new Date(Date.now() + 86_400_000));
}

async function waitUntilDeleted(api, accountId, { id, date }, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while ((await api.getTransactions(accountId, date, date)).some((t) => t.id === id)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Actual Budget error: transaction ${id} was not deleted after ${timeoutMs}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
