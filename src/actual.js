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
  } finally {
    await api.shutdown();
  }
}

export async function importTransactions(api, accountId, transactions) {
  log.debug("Transactions to import:", transactions);
  const result = await api.importTransactions(accountId, transactions);
  log.info(
    `Imported into ${accountId}: ${result.added.length} added, ${result.updated.length} updated`,
  );
  if (result.errors?.length) log.error("Actual import errors:", result.errors);
}

/** Deletes the Actual transactions whose imported_id is in importedIds. */
export async function deleteByImportedIds(api, accountId, importedIds, sinceDate) {
  const wanted = new Set(importedIds);
  const today = new Date().toISOString().slice(0, 10);
  const existing = await api.getTransactions(accountId, sinceDate, today);
  const toDelete = existing.filter((t) => wanted.has(t.imported_id));

  for (const transaction of toDelete) {
    await api.deleteTransaction(transaction.id);
  }
  if (toDelete.length > 0) {
    log.info(`Deleted ${toDelete.length} cancelled transaction(s) from ${accountId}`);
  }
}
