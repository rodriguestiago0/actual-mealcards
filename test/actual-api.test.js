// Runs the import against the real @actual-app/api on a local budget: no server, no network.
// Catches the fake API (test/fake-api.js) drifting from what an API update actually does.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import * as realApi from "@actual-app/api";
import { deleteByImportedIds, importTransactions } from "../src/actual.js";
import { importEdenred } from "../src/engine.js";

const syncId = "local-budget";

// The API's deleteTransaction resolves before the delete is applied (api/transaction-delete
// doesn't await transactions-batch-update), so wait for it to show.
async function waitUntilDeleted(accountId, date) {
  for (let i = 0; i < 100; i++) {
    if ((await realApi.getTransactions(accountId, date, date)).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`transactions on ${date} were not deleted`);
}

describe("import against the real Actual API", () => {
  let dataDir;
  let budgetId;
  let accountId;
  // withBudget would download the budget from a server; load the local one instead. Everything
  // else (init without a server, getAccounts, importTransactions, sync, shutdown) is the real API.
  // sync() needs a server too, so it's a no-op here.
  const localApi = () => ({
    ...realApi,
    downloadBudget: () => realApi.loadBudget(budgetId),
    sync: async () => {},
  });

  async function openBudget() {
    await realApi.init({ dataDir: join(dataDir, syncId) });
    await realApi.loadBudget(budgetId);
  }

  before(async () => {
    // The API logs through console; keep the test output readable.
    for (const method of ["log", "info", "debug"]) mock.method(console, method, () => {});
    dataDir = await mkdtemp(join(tmpdir(), "actual-mealcards-test-"));
    // The API writes metadata.json without awaiting it (savePrefs from the sync listener), so it
    // can still be writing after shutdown(). Remove the budget only once the process is done.
    process.on("exit", () => rmSync(dataDir, { recursive: true, force: true }));
    await mkdir(join(dataDir, syncId));
    const internal = await realApi.init({ dataDir: join(dataDir, syncId) });
    await internal.send("create-budget", { budgetName: "Test", avoidUpload: true });
    [{ id: budgetId }] = await realApi.getBudgets();
    accountId = await realApi.createAccount({ name: "Edenred" }, 0);
    await realApi.shutdown();
  });

  after(async () => {
    await realApi.shutdown().catch(() => {});
    mock.restoreAll();
  });

  it("imports Edenred movements once and skips them on the next run", async (t) => {
    const fetch = mock.method(globalThis, "fetch", async (url) =>
      Response.json(
        url.includes("/authenticate/pin")
          ? { data: { token: "tok" } }
          : {
              data: {
                movementList: [
                  {
                    transactionName: "cafe",
                    transactionDate: "2024-12-02T09:30:00",
                    amount: -4.35,
                  },
                  {
                    transactionName: "cafe",
                    transactionDate: "2024-12-02T09:30:00",
                    amount: -4.35,
                  },
                  {
                    transactionName: "Top-up",
                    transactionDate: "2024-12-01T00:00:00",
                    amount: 160.6,
                  },
                ],
              },
            },
      ),
    );
    t.after(() => fetch.mock.restore());
    const config = {
      actual: { syncId, dataDir, reimportDeleted: false },
      edenred: {
        username: "u",
        pin: "1",
        version: "4.1.0",
        importFrom: "1970-01-01",
        accounts: { card: accountId },
      },
    };

    await importEdenred(config, localApi());
    await importEdenred(config, localApi());

    await openBudget();
    const saved = await realApi.getTransactions(accountId, "2024-01-01", "2024-12-31");
    const payees = await realApi.getPayees();
    await realApi.shutdown();
    assert.deepEqual(
      saved
        .map((tx) => ({
          amount: tx.amount,
          date: tx.date,
          cleared: tx.cleared,
          payee: payees.find((payee) => payee.id === tx.payee)?.name,
        }))
        .sort((a, b) => a.amount - b.amount),
      [
        { amount: -435, date: "2024-12-02", cleared: true, payee: "Cafe" },
        { amount: -435, date: "2024-12-02", cleared: true, payee: "Cafe" },
        { amount: 16060, date: "2024-12-01", cleared: true, payee: "Top-Up" },
      ],
    );
  });

  it("returns the shapes the code relies on", async () => {
    await openBudget();
    try {
      const transactions = [
        { date: "2024-06-01", amount: -100, imported_id: "shape-1", payee_name: "Shop" },
      ];
      const first = await realApi.importTransactions(accountId, transactions, {
        reimportDeleted: false,
        payeeNameNormalization: "title-case",
      });
      assert.deepEqual(first.errors, []);
      assert.equal(first.added.length, 1);
      assert.equal(typeof first.added[0], "string");
      assert.deepEqual(await importTransactions(realApi, accountId, transactions), []);

      // getTransactions honours the date range, so deleteByImportedIds only sees its window.
      assert.deepEqual(await realApi.getTransactions(accountId, "2024-06-02", "2024-06-30"), []);
      const api = { ...realApi, deleteTransaction: mock.fn(realApi.deleteTransaction) };
      await deleteByImportedIds(api, accountId, ["shape-1"], "2024-06-02");
      assert.equal(api.deleteTransaction.mock.callCount(), 0);
      await deleteByImportedIds(api, accountId, ["shape-1"], "2024-06-01");
      assert.equal(api.deleteTransaction.mock.callCount(), 1);
      await waitUntilDeleted(accountId, "2024-06-01");

      // A deleted transaction stays deleted unless reimportDeleted is set (the API's default is to
      // reimport it, hence the explicit option in importTransactions).
      assert.deepEqual(await importTransactions(realApi, accountId, transactions), []);
      assert.deepEqual(await realApi.getTransactions(accountId, "2024-06-01", "2024-06-01"), []);
      const reimported = await realApi.importTransactions(accountId, transactions, {
        reimportDeleted: true,
      });
      assert.equal(reimported.added.length, 1);
    } finally {
      await realApi.shutdown();
    }
  });
});
