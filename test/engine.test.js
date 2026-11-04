import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  deleteByImportedIds,
  importTransactions,
  updateChangedTransactions,
  withBudget,
} from "../src/actual.js";
import {
  checkCoverflexTokenExpiry,
  importCoverflex,
  importEdenred,
  runEnabledImports,
} from "../src/engine.js";
import { parseNotificationUrls } from "../src/notify.js";
import { callsTo, fakeApi } from "./fake-api.js";

const notifications = parseNotificationUrls("telegram://1:token@telegram?chats=42");
const actualConfig = { serverURL: "x", password: "p", syncId: "s", dataDir: "./temp_data_test" };
const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

function mockFetch(t) {
  const fetch = mock.method(globalThis, "fetch", async () => new Response("{}"));
  t.after(() => fetch.mock.restore());
  return fetch;
}
const sentTexts = (fetch) =>
  fetch.mock.calls.map((call) => JSON.parse(call.arguments[1].body).text);

describe("withBudget", () => {
  it("still shuts down when the callback throws", async () => {
    const api = fakeApi();
    await assert.rejects(
      withBudget(actualConfig, async () => Promise.reject(new Error("boom")), api),
      /boom/,
    );
    assert.equal(callsTo(api, "shutdown").length, 1);
    assert.equal(callsTo(api, "sync").length, 0);
  });

  it("reports the callback's error when shutdown also fails", async () => {
    const api = fakeApi();
    api.shutdown = async () => Promise.reject(new Error("shutdown failed"));
    await assert.rejects(
      withBudget(actualConfig, async () => Promise.reject(new Error("boom")), api),
      /boom/,
    );
  });
});

describe("withBudget success path", () => {
  it("syncs and shuts down once, passing the file password only when set", async () => {
    const plain = fakeApi();
    await withBudget(actualConfig, async () => {}, plain);
    assert.deepEqual(callsTo(plain, "downloadBudget"), [["downloadBudget", "s", {}]]);
    assert.equal(callsTo(plain, "sync").length, 1);
    assert.equal(callsTo(plain, "shutdown").length, 1);

    const encrypted = fakeApi();
    await withBudget({ ...actualConfig, filePassword: "secret" }, async () => {}, encrypted);
    assert.deepEqual(callsTo(encrypted, "downloadBudget"), [
      ["downloadBudget", "s", { password: "secret" }],
    ]);
  });
});

describe("importTransactions", () => {
  it("doesn't reimport deleted transactions and pins title-case payee names", async () => {
    const api = fakeApi();
    const transactions = [{ imported_id: "x", amount: -100 }];
    await importTransactions(api, "A", transactions);
    assert.deepEqual(callsTo(api, "importTransactions"), [
      [
        "importTransactions",
        "A",
        transactions,
        { reimportDeleted: false, payeeNameNormalization: "title-case" },
      ],
    ]);
  });

  it("reimports deleted transactions when asked to", async () => {
    const api = fakeApi();
    await importTransactions(api, "A", [], { reimportDeleted: true });
    assert.equal(callsTo(api, "importTransactions")[0][3].reimportDeleted, true);
  });
});

describe("deleteByImportedIds", () => {
  it("deletes only the Actual transactions with a cancelled imported_id", async () => {
    const api = fakeApi({
      transactions: {
        A: [
          { id: "t1", date: "2024-02-01", imported_id: "keep" },
          { id: "t2", date: "2024-02-01", imported_id: "cancelled" },
        ],
      },
    });
    await deleteByImportedIds(api, "A", ["cancelled"], "2024-01-01");
    assert.deepEqual(callsTo(api, "deleteTransaction"), [["deleteTransaction", "t2"]]);
  });
});

describe("updateChangedTransactions", () => {
  it("updates changed amounts and dates, but not reconciled or split transactions", async () => {
    const existing = (id, overrides) => ({
      id: `t-${id}`,
      imported_id: id,
      amount: -100,
      date: "2024-01-01",
      ...overrides,
    });
    const api = fakeApi({
      transactions: {
        A: [
          existing("same"),
          existing("amount"),
          existing("date"),
          existing("reconciled", { reconciled: true }),
          existing("split", { is_parent: true }),
          existing("other"),
        ],
      },
    });
    const incoming = (id, overrides) => ({
      imported_id: id,
      amount: -100,
      date: "2024-01-01",
      ...overrides,
    });
    await updateChangedTransactions(
      api,
      "A",
      [
        incoming("same"),
        incoming("amount", { amount: -125 }),
        incoming("date", { date: "2024-01-03" }),
        incoming("reconciled", { amount: -125 }),
        incoming("split", { amount: -125 }),
      ],
      "2024-01-01",
    );
    assert.deepEqual(callsTo(api, "updateTransaction"), [
      ["updateTransaction", "t-amount", { amount: -125 }],
      ["updateTransaction", "t-date", { date: "2024-01-03" }],
    ]);
  });
});

describe("importCoverflex", () => {
  it("logs in once for all pockets", async (t) => {
    const fetch = mock.method(globalThis, "fetch", async (url) =>
      Response.json(url.endsWith("/sessions") ? { token: "t" } : { movements: { list: [] } }),
    );
    t.after(() => fetch.mock.restore());
    const config = {
      actual: actualConfig,
      coverflex: {
        userAgentToken: "ua",
        importFrom: "1970-01-01",
        accounts: { "pocket-1": "A", "pocket-2": "B" },
      },
    };

    await importCoverflex(config, fakeApi({ accounts: [{ id: "A" }, { id: "B" }] }));
    const urls = fetch.mock.calls.map((call) => call.arguments[0]);
    assert.equal(urls.filter((url) => url.endsWith("/sessions")).length, 1);
    assert.equal(urls.filter((url) => url.includes("/movements")).length, 2);
  });

  it("fails before importing when an Actual account isn't open", async (t) => {
    const fetch = mock.method(globalThis, "fetch", async (url) =>
      Response.json(url.endsWith("/sessions") ? { token: "t" } : { movements: { list: [] } }),
    );
    t.after(() => fetch.mock.restore());
    const config = {
      actual: actualConfig,
      coverflex: {
        userAgentToken: "ua",
        importFrom: "1970-01-01",
        accounts: { "pocket-1": "A", "pocket-2": "gone" },
      },
    };
    const api = fakeApi({ accounts: [{ id: "A" }, { id: "gone", closed: true }] });
    await assert.rejects(
      importCoverflex(config, api),
      /Coverflex: not an open account in this budget: "gone" \(for pocket-2\)/,
    );
    assert.equal(callsTo(api, "importTransactions").length, 0);
  });

  it("syncs, then fails when Actual rejects part of an import", async (t) => {
    const fetch = mock.method(globalThis, "fetch", async (url) =>
      Response.json(
        url.endsWith("/sessions")
          ? { token: "t" }
          : {
              movements: {
                list: [
                  {
                    id: "m1",
                    executed_at: "2024-01-01T00:00:00Z",
                    status: "confirmed",
                    is_debit: true,
                    amount: { amount: 100 },
                    description: "Shop",
                  },
                ],
              },
            },
      ),
    );
    t.after(() => fetch.mock.restore());
    const api = fakeApi({ accounts: [{ id: "A" }] });
    api.importTransactions = async () => ({ added: [], updated: [], errors: [{ message: "bad" }] });
    const config = {
      actual: actualConfig,
      coverflex: { userAgentToken: "ua", importFrom: "1970-01-01", accounts: { "pocket-1": "A" } },
    };

    await assert.rejects(importCoverflex(config, api), /import errors for account\(s\): A/);
    assert.equal(callsTo(api, "sync").length, 1);
  });
});

describe("importEdenred", () => {
  const movement = (name) => ({
    transactionName: name,
    transactionDate: "2024-12-02T09:30:00",
    amount: -4.35,
  });
  const config = (accounts) => ({
    actual: actualConfig,
    edenred: { username: "u", pin: "1234", version: "4.1.0", importFrom: "1970-01-01", accounts },
  });

  function mockEdenred(t, movementsByCard, { loginStatus = 200 } = {}) {
    const fetch = mock.method(globalThis, "fetch", async (url) => {
      if (url.includes("/authenticate/pin")) {
        return loginStatus === 200
          ? Response.json({ data: { token: "tok" } })
          : new Response("denied", { status: loginStatus });
      }
      const card = url.match(/\/card\/([^/]+)\/accountmovement/)[1];
      return Response.json({ data: { movementList: movementsByCard[card] ?? [] } });
    });
    t.after(() => fetch.mock.restore());
    return fetch;
  }

  it("logs in once and imports each card into its Actual account", async (t) => {
    const fetch = mockEdenred(t, { card1: [movement("Cafe")], card3: [movement("Lunch")] });
    const api = fakeApi({ accounts: [{ id: "A" }, { id: "B" }, { id: "C" }] });

    await importEdenred(config({ card1: "A", card2: "B", card3: "C" }), api);

    const urls = fetch.mock.calls.map((call) => call.arguments[0]);
    assert.equal(urls.filter((url) => url.includes("/authenticate/pin")).length, 1);
    assert.equal(urls.filter((url) => url.includes("/accountmovement")).length, 3);
    const movementCalls = fetch.mock.calls.filter((call) =>
      call.arguments[0].includes("/accountmovement"),
    );
    for (const call of movementCalls) {
      assert.equal(call.arguments[1].headers.Authorization, "tok");
    }
    // card2 has no movements, so nothing is imported into B.
    assert.deepEqual(
      callsTo(api, "importTransactions").map(([, account, txs]) => [account, txs[0].payee_name]),
      [
        ["A", "Cafe"],
        ["C", "Lunch"],
      ],
    );
    assert.equal(callsTo(api, "sync").length, 1);
    assert.equal(callsTo(api, "shutdown").length, 1);
  });

  it("doesn't open the budget when login fails", async (t) => {
    mockEdenred(t, {}, { loginStatus: 401 });
    const api = fakeApi({ accounts: [{ id: "A" }] });
    await assert.rejects(importEdenred(config({ card1: "A" }), api), /failed: 401$/);
    assert.equal(api.calls.length, 0);
  });

  it("fails before importing when an Actual account isn't open", async (t) => {
    mockEdenred(t, { card1: [movement("Cafe")] });
    const api = fakeApi({ accounts: [{ id: "A", closed: true }] });
    await assert.rejects(
      importEdenred(config({ card1: "A" }), api),
      /Edenred: not an open account in this budget: "A" \(for card1\)/,
    );
    assert.equal(callsTo(api, "importTransactions").length, 0);
    assert.equal(callsTo(api, "shutdown").length, 1);
  });

  it("imports the other cards, syncs, then fails when Actual rejects part of an import", async (t) => {
    mockEdenred(t, { card1: [movement("Cafe")], card2: [movement("Lunch")] });
    const api = fakeApi({ accounts: [{ id: "A" }, { id: "B" }] });
    api.importTransactions = async (account) => ({
      added: [],
      updated: [],
      errors: account === "A" ? [{ message: "bad" }] : [],
    });

    await assert.rejects(
      importEdenred(config({ card1: "A", card2: "B" }), api),
      /import errors for account\(s\): A$/,
    );
    assert.equal(callsTo(api, "sync").length, 1);
  });
});

describe("importCoverflex per pocket", () => {
  it("imports the other pockets when one fails, then reports every failure", async (t) => {
    const write = mock.method(process.stderr, "write", () => true);
    t.after(() => write.mock.restore());
    const lunch = {
      id: "m1",
      executed_at: "2024-01-01T00:00:00Z",
      status: "confirmed",
      is_debit: true,
      amount: { amount: 100 },
      description: "Shop",
    };
    const fetch = mock.method(globalThis, "fetch", async (url) => {
      if (url.endsWith("/sessions")) return Response.json({ token: "t" });
      if (url.includes("pocket-1")) return new Response("no", { status: 403 });
      return Response.json({ movements: { list: [lunch, { ...lunch, id: "m2", amount: {} }] } });
    });
    t.after(() => fetch.mock.restore());
    const api = fakeApi({ accounts: [{ id: "A" }, { id: "B" }] });
    const config = {
      actual: actualConfig,
      coverflex: {
        userAgentToken: "ua",
        importFrom: "1970-01-01",
        accounts: { "pocket-1": "A", "pocket-2": "B" },
      },
    };

    await assert.rejects(importCoverflex(config, api), {
      message:
        "Coverflex pocket-1: GET /api/employee/movements failed: 403\n" +
        "Coverflex pocket-2: skipped 1 malformed movement(s)",
    });
    assert.deepEqual(
      callsTo(api, "importTransactions").map(([, account, txs]) => [account, txs.length]),
      [["B", 1]],
    );
    assert.equal(callsTo(api, "sync").length, 1);
  });
});

describe("runEnabledImports", () => {
  it("runs enabled imports, continuing and notifying after a failure", async (t) => {
    const fetch = mockFetch(t);
    const ran = [];
    const registry = {
      Broken: { enabled: () => true, run: async () => Promise.reject(new Error("auth failed")) },
      Disabled: { enabled: () => false, run: async () => ran.push("Disabled") },
      Working: { enabled: () => true, run: async () => ran.push("Working") },
    };

    assert.equal(await runEnabledImports({ notifications }, registry), false);
    assert.deepEqual(ran, ["Working"]);
    assert.deepEqual(sentTexts(fetch), ["❌ actual-mealcards: Broken import failed\nauth failed"]);
  });
});

describe("runEnabledImports recovery", () => {
  it("notifies once when an import works again after failing", async (t) => {
    const fetch = mockFetch(t);
    let fail = true;
    const registry = {
      Flaky: {
        enabled: () => true,
        run: async () => {
          if (fail) throw new Error("down");
        },
      },
    };
    const quiet = mock.method(process.stderr, "write", () => true);
    t.after(() => quiet.mock.restore());

    assert.equal(await runEnabledImports({ notifications }, registry), false);
    fail = false;
    assert.equal(await runEnabledImports({ notifications }, registry), true);
    assert.equal(await runEnabledImports({ notifications }, registry), true);
    assert.deepEqual(sentTexts(fetch), [
      "❌ actual-mealcards: Flaky import failed\ndown",
      "✅ actual-mealcards: Flaky recovered",
    ]);
  });
});

describe("checkCoverflexTokenExpiry", () => {
  const now = new Date("2027-10-10T12:00:00Z");
  const configExpiring = (date) => ({
    notifications,
    coverflex: { userAgentToken: jwt({ exp: Date.parse(date) / 1000 }) },
  });

  it("stays quiet when the token is far from expiring", async (t) => {
    const fetch = mockFetch(t);
    await checkCoverflexTokenExpiry(configExpiring("2028-01-01T00:00:00Z"), now);
    assert.equal(fetch.mock.callCount(), 0);
  });

  it("warns once a day in the last 30 days", async (t) => {
    const fetch = mockFetch(t);
    const config = configExpiring("2027-10-28T00:00:00Z");
    await checkCoverflexTokenExpiry(config, now);
    await checkCoverflexTokenExpiry(config, now);
    assert.deepEqual(sentTexts(fetch), [
      "⚠️ actual-mealcards: Coverflex user agent token expires in 17 day(s). Run get-coverflex-token.",
    ]);
  });
});
