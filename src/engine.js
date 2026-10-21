import { deleteByImportedIds, importTransactions, withBudget } from "./actual.js";
import * as coverflex from "./providers/coverflex.js";
import * as edenred from "./providers/edenred.js";

export async function importEdenred(config) {
  await withBudget(config.actual, async () => {
    for (const [edenredAccount, actualAccount] of Object.entries(config.edenred.accounts)) {
      console.info(`Importing Edenred account ${edenredAccount}`);
      const transactions = await edenred.getTransactions(config.edenred, edenredAccount);
      if (transactions.length === 0) {
        console.info("No transactions to import");
        continue;
      }
      await importTransactions(actualAccount, transactions);
    }
  });
}

export async function importCoverflex(config) {
  await withBudget(config.actual, async () => {
    for (const [pocketId, actualAccount] of Object.entries(config.coverflex.accounts)) {
      console.info(`Importing Coverflex pocket ${pocketId}`);
      const { transactions, cancelledIds } = await coverflex.getTransactions(
        config.coverflex,
        pocketId,
      );
      if (transactions.length === 0) {
        console.info("No transactions to import");
      } else {
        await importTransactions(actualAccount, transactions);
      }
      if (cancelledIds.length > 0) {
        await deleteByImportedIds(actualAccount, cancelledIds, config.coverflex.importFrom);
      }
    }
  });
}

export async function runEnabledImports(config) {
  const imports = [
    ["Edenred", config.edenred, importEdenred],
    ["Coverflex", config.coverflex, importCoverflex],
  ];
  let failed = false;
  for (const [name, providerConfig, run] of imports) {
    if (!providerConfig) continue;
    try {
      await run(config);
    } catch (err) {
      failed = true;
      console.error(`${name} import failed:`, err);
    }
  }
  return !failed;
}
