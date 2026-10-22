import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { deleteByImportedIds, withBudget } from "../src/actual.js";
import { checkCoverflexTokenExpiry, importCoverflex, runEnabledImports } from "../src/engine.js";
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
});

describe("deleteByImportedIds", () => {
  it("deletes only the Actual transactions with a cancelled imported_id", async () => {
    const api = fakeApi({
      transactions: {
        A: [
          { id: "t1", imported_id: "keep" },
          { id: "t2", imported_id: "cancelled" },
        ],
      },
    });
    await deleteByImportedIds(api, "A", ["cancelled"], "2024-01-01");
    assert.deepEqual(callsTo(api, "deleteTransaction"), [["deleteTransaction", "t2"]]);
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

    await importCoverflex(config, fakeApi());
    const urls = fetch.mock.calls.map((call) => call.arguments[0]);
    assert.equal(urls.filter((url) => url.endsWith("/sessions")).length, 1);
    assert.equal(urls.filter((url) => url.includes("/movements")).length, 2);
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
    const api = fakeApi();
    api.importTransactions = async () => ({ added: [], updated: [], errors: [{ message: "bad" }] });
    const config = {
      actual: actualConfig,
      coverflex: { userAgentToken: "ua", importFrom: "1970-01-01", accounts: { "pocket-1": "A" } },
    };

    await assert.rejects(importCoverflex(config, api), /import errors for account\(s\): A/);
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
