import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as actualApi from "@actual-app/api";
import { log } from "./log.js";

/** Opens the budget, runs fn(api), then syncs and always shuts down. */
export async function withBudget(
  { serverURL, password, filePassword, syncId, dataDir },
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

  try {
    await fn(api);
    await api.sync();
  } catch (err) {
    await api.shutdown().catch(() => {});
    throw err;
  }
  await api.shutdown();
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
    `Imported into ${accountId}: ${result.added.length} added, ${result.updated.length} updated`,
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
  if (updated > 0) log.info(`Updated amount or date of ${updated} transaction(s) in ${accountId}`);
}

/**
 * Deletes the Actual transactions whose imported_id is in importedIds, except reconciled ones:
 * deleting those would change a reconciled balance, so they are only reported.
 */
export async function deleteByImportedIds(api, accountId, importedIds, sinceDate) {
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
    log.info(`Deleted cancelled transaction ${describe(transaction)} from ${accountId}`);
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
