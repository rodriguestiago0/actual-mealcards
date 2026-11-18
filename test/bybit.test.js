import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { loadConfig } from "../src/config.js";
import { importBybit } from "../src/engine.js";
import * as bybit from "../src/providers/bybit.js";
import { callsTo, fakeApi } from "./fake-api.js";

const CARD_HEADER =
  "Uid,Last 4 Digits,Type,Order Type,Status,Transaction Amount,Total Fee,Currency,Merchant Name," +
  "Transaction Date & Time,Transaction ID,Payment ID,Category,Location,Settlement Time," +
  "Payment Amount,Payment Currency,Total Mark-up over ECB Rate,Points Earned";
const card = ({ type = "DEDUCT", status = "SUCCESS", amount = "10.900000000000000000" } = {}) => ({
  Type: type,
  Status: status,
  "Transaction Amount": amount,
  "Total Fee": "0.0",
  Currency: "EUR",
  "Merchant Name": "CAFE, LDA",
  "Transaction Date & Time": "2026-11-17 08:03:36",
  "Transaction ID": "200",
  "Payment Amount": amount,
  "Payment Currency": "EUR",
});
const deposit = (overrides) => ({
  OrderID: "EXC1",
  Type: "DEPOSIT",
  Fiat: "EUR",
  DepositAmount: "200.000000000000000000",
  FinalAmount: "200.000000000000000000",
  PaymentMethods: "SEPA",
  OrderTime: String(Date.UTC(2026, 4, 16, 12)),
  CompletedTime: String(Date.UTC(2026, 4, 16, 12)),
  ...overrides,
});

describe("bybit.signedHeaders", () => {
  it("signs timestamp + key + recv window + payload with HMAC-SHA256", () => {
    const headers = bybit.signedHeaders(
      { apiKey: "key", apiSecret: "secret" },
      '{"a":1}',
      1_700_000_000_000,
    );
    assert.equal(
      headers["X-BAPI-SIGN"],
      "13e536de6f7ec55159302c32ca3a8f44bbae7bbc3b4df0ebd795966e34943ed8",
    );
    assert.equal(headers["X-BAPI-TIMESTAMP"], "1700000000000");
    assert.equal(headers["X-BAPI-API-KEY"], "key");
  });
});

describe("bybit.parseCsv", () => {
  it("handles quoted commas, escaped quotes, CRLF and a missing final newline", () => {
    const rows = bybit.parseCsv('a,b\r\n"x, y","say ""hi"""\r\n1,2');
    assert.deepEqual(rows, [
      { a: "x, y", b: 'say "hi"' },
      { a: "1", b: "2" },
    ]);
  });

  it("returns nothing for an empty file", () => {
    assert.deepEqual(bybit.parseCsv(""), []);
  });
});

describe("bybit.exportRanges", () => {
  it("splits long ranges into chunks the export accepts", () => {
    const day = 86_400_000;
    const ranges = bybit.exportRanges(0, 400 * day);
    assert.deepEqual(ranges, [
      [0, 360 * 86_400],
      [360 * 86_400, 400 * 86_400],
    ]);
  });
});

describe("bybit.mapCardRows", () => {
  it("imports settled purchases and refunds and ignores authorizations", () => {
    const skipped = [];
    const transactions = bybit.mapCardRows(
      [
        card(),
        { ...card({ type: "REFUND", status: "PENDING", amount: "1.99" }), "Transaction ID": "201" },
        card({ type: "FREEZE" }),
        card({ type: "UNFREEZE" }),
        card({ type: "REFUND_REQUEST" }),
        card({ type: "DEDUCT", status: "FAIL" }),
      ],
      "1970-01-01",
      skipped,
    );
    assert.deepEqual(transactions, [
      {
        date: "2026-11-17",
        amount: -1090,
        payee_name: "CAFE, LDA",
        imported_payee: "CAFE, LDA",
        imported_id: "200",
        cleared: true,
      },
      {
        date: "2026-11-17",
        amount: 199,
        payee_name: "CAFE, LDA",
        imported_payee: "CAFE, LDA",
        imported_id: "201",
        cleared: false,
      },
    ]);
    assert.deepEqual(skipped, []);
  });

  it("dates purchases by their authorization, matched by merchant and amount", () => {
    const row = (type, id, day, amount = "10.9") => ({
      ...card({ type, amount }),
      "Transaction ID": id,
      "Transaction Date & Time": `${day} 12:00:00`,
    });
    const transactions = bybit.mapCardRows(
      [
        row("FREEZE", "a1", "2026-11-14"),
        row("FREEZE", "a2", "2026-11-15"),
        row("FREEZE", "a3", "2026-11-15", "5"),
        row("DEDUCT", "d1", "2026-11-16"),
        row("DEDUCT", "d2", "2026-11-17"),
        row("DEDUCT", "d3", "2026-11-17", "7"),
      ],
      "1970-01-01",
    );
    assert.deepEqual(
      transactions.map(({ imported_id, date }) => [imported_id, date]),
      [
        ["d1", "2026-11-15"],
        ["d2", "2026-11-14"],
        ["d3", "2026-11-17"],
      ],
    );
  });

  it("notes the original amount and fee of foreign purchases", () => {
    const [transaction] = bybit.mapCardRows(
      [
        {
          ...card({ amount: "394.030000000000000000" }),
          "Payment Amount": "447.900000000000000000",
          "Payment Currency": "USD",
          "Total Fee": "1.96",
        },
      ],
      "1970-01-01",
    );
    assert.equal(transaction.amount, -39403);
    assert.equal(transaction.notes, "447.90 USD, fee 1.96 EUR");
  });

  it("filters by date and reports unreadable or unknown rows", () => {
    const skipped = [];
    const transactions = bybit.mapCardRows(
      [card(), card({ amount: "abc" }), card({ type: "ATM" })],
      "2026-11-18",
      skipped,
    );
    assert.deepEqual(transactions, []);
    assert.equal(skipped.length, 2);
  });
});

describe("bybit.mapDepositRows", () => {
  it("imports deposits as inflows and deposit refunds as outflows", () => {
    const skipped = [];
    const transactions = bybit.mapDepositRows(
      [
        deposit(),
        deposit({ OrderID: "RF1", Type: "REFUND", PaymentMethods: "MB_Way", CompletedTime: "0" }),
        deposit({ OrderID: "X", Type: "SOMETHING" }),
      ],
      "1970-01-01",
      skipped,
    );
    assert.deepEqual(
      transactions.map(({ amount, payee_name, imported_id }) => ({
        amount,
        payee_name,
        imported_id,
      })),
      [
        { amount: 20000, payee_name: "SEPA deposit", imported_id: "EXC1" },
        { amount: -20000, payee_name: "MB Way deposit refund", imported_id: "RF1" },
      ],
    );
    assert.equal(transactions[1].date, transactions[0].date, "falls back to OrderTime");
    assert.deepEqual(skipped, ["deposit SOMETHING X"]);
  });
});

describe("bybit.mapBonusRows", () => {
  it("imports euro bonuses, telling identical ones apart", () => {
    const time = String(Date.UTC(2026, 6, 29, 12));
    const skipped = [];
    const transactions = bybit.mapBonusRows(
      [
        { Coin: "EUR", FinalAmount: "2.000000000000000000", CompletedTime: time },
        { Coin: "EUR", FinalAmount: "2.000000000000000000", CompletedTime: time },
        { Coin: "EUR", FinalAmount: "0.35", CompletedTime: time },
        { Coin: "USDC", FinalAmount: "5", CompletedTime: time },
        { Coin: "EUR", FinalAmount: "x", CompletedTime: time },
      ],
      "1970-01-01",
      skipped,
    );
    assert.deepEqual(
      transactions.map(({ amount, payee_name, imported_id }) => ({
        amount,
        payee_name,
        imported_id,
      })),
      [
        { amount: 200, payee_name: "Bybit bonus", imported_id: `bonus-${time}-200-1` },
        { amount: 200, payee_name: "Bybit bonus", imported_id: `bonus-${time}-200-2` },
        { amount: 35, payee_name: "Bybit bonus", imported_id: `bonus-${time}-35-1` },
      ],
    );
    assert.equal(transactions[0].date, "2026-07-29");
    assert.deepEqual(skipped, [`bonus ${time}`]);
  });
});

describe("bybit.mapInternalTransfers", () => {
  const transfer = (overrides) => ({
    transferId: "selfTransfer_1",
    coin: "EUR",
    amount: "0.64",
    fromAccountType: "UNIFIED",
    toAccountType: "FUND",
    timestamp: String(Date.UTC(2026, 10, 16, 12)),
    status: "SUCCESS",
    ...overrides,
  });

  it("imports transfers into and out of the Funding account, and nothing else", () => {
    const skipped = [];
    const transactions = bybit.mapInternalTransfers(
      [
        transfer(),
        transfer({
          transferId: "out",
          amount: "300",
          fromAccountType: "FUND",
          toAccountType: "UNIFIED",
        }),
        transfer({ transferId: "pending", status: "PENDING" }),
        transfer({ transferId: "other", fromAccountType: "UNIFIED", toAccountType: "CONTRACT" }),
        transfer({ transferId: "bad", amount: "x" }),
      ],
      "1970-01-01",
      skipped,
    );
    assert.deepEqual(
      transactions.map(({ amount, payee_name, imported_id, counterparty }) => ({
        amount,
        payee_name,
        imported_id,
        counterparty,
      })),
      [
        {
          amount: 64,
          payee_name: "Bybit Unified",
          imported_id: "selfTransfer_1",
          counterparty: "UNIFIED",
        },
        {
          amount: -30000,
          payee_name: "Bybit Unified",
          imported_id: "out",
          counterparty: "UNIFIED",
        },
      ],
    );
    assert.equal(transactions[0].date, "2026-11-16");
    assert.deepEqual(skipped, ["transfer bad"]);
  });
});

describe("importBybit", () => {
  it("exports, downloads and imports card and deposit rows into one account", async (t) => {
    const s3 = "https://s3.example/";
    const fileUrl = (name) =>
      JSON.stringify({ Basepath: s3, Files: [`${name}/_SUCCESS`, `${name}/part-0.csv`] });
    let polls = 0;
    const fetch = mock.method(globalThis, "fetch", async (url, init) => {
      const ok = (result) => Response.json({ retCode: 0, retMsg: "OK", result });
      if (url.endsWith("/registertime")) return ok({ registerTime: "1767225600" });
      if (url.endsWith("/batch_create")) {
        const body = JSON.parse(init.body);
        assert.equal(body.startTime, 1767225600 - 86_400);
        return ok({ batchId: "b1" });
      }
      if (url.includes("/batch_query")) {
        polls++;
        const status = polls === 1 ? 1 : 2;
        return ok({
          items: [
            { type: "CARD", number: "1", status, url: status === 2 ? fileUrl("card") : "" },
            {
              type: "DEPOSIT&WITHDRAWAL",
              number: "3",
              status,
              url: status === 2 ? fileUrl("dep") : "",
            },
          ],
        });
      }
      if (url === `${s3}card/part-0.csv`) {
        return new Response(
          `${CARD_HEADER}\n1,5836,DEDUCT,Transaction Completed,SUCCESS,10.9,0.0,EUR,` +
            `"CAFE, LDA",2026-11-17 08:03:36,200,p,Food,"PRT,PORTO",0,10.9,EUR,0%,55\n`,
        );
      }
      if (url === `${s3}dep/part-0.csv`) {
        return new Response(
          "OrderID,Type,Fiat,DepositAmount,FinalAmount,Fee,PaymentMethods,OrderTime,CompletedTime\n" +
            `EXC1,DEPOSIT,EUR,200,200,0,SEPA,${Date.UTC(2026, 4, 16)},${Date.UTC(2026, 4, 16)}\n`,
        );
      }
      if (url.includes("/query-inter-transfer-list")) {
        const params = new URL(url).searchParams;
        assert.ok(
          Number(params.get("endTime")) - Number(params.get("startTime")) <= 7 * 86_400_000,
        );
        transferCalls++;
        const list =
          transferCalls === 1
            ? [
                {
                  transferId: "selfTransfer_1",
                  coin: "EUR",
                  amount: "300",
                  fromAccountType: "FUND",
                  toAccountType: "UNIFIED",
                  timestamp: String(Date.UTC(2026, 5, 20, 12)),
                  status: "SUCCESS",
                },
              ]
            : [];
        // Bybit sends a cursor even when there is nothing more.
        return ok({ list, nextPageCursor: "more" });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    let transferCalls = 0;
    t.after(() => fetch.mock.restore());
    mock.timers.enable({ apis: ["setTimeout"] });
    t.after(() => mock.timers.reset());

    const config = {
      actual: { serverURL: "x", password: "p", syncId: "s", dataDir: "./temp_data_test" },
      bybit: {
        apiKey: "k",
        apiSecret: "s",
        importFrom: "1970-01-01",
        actualAccount: "A",
        transferAccount: "C",
      },
    };
    const api = fakeApi({
      accounts: [{ id: "A" }, { id: "C" }],
      payees: [{ id: "payee-C", transfer_acct: "C" }],
    });
    const run = importBybit(config, api);
    // Let the first poll answer "processing", then skip the poll interval.
    for (let i = 0; i < 20 && polls < 1; i++) await new Promise(setImmediate);
    mock.timers.tick(5_000);
    await run;

    const [[, account, transactions]] = callsTo(api, "importTransactions");
    assert.equal(account, "A");
    assert.deepEqual(
      transactions.map(({ amount, payee_name, payee }) => ({ amount, payee_name, payee })),
      [
        { amount: -1090, payee_name: "CAFE, LDA", payee: undefined },
        { amount: 20000, payee_name: "SEPA deposit", payee: undefined },
        { amount: -30000, payee_name: undefined, payee: "payee-C" },
      ],
    );
    assert.ok(transactions.every((transaction) => !("counterparty" in transaction)));
    const signed = fetch.mock.calls.filter((call) => call.arguments[0].includes("bybit.eu"));
    assert.ok(signed.every((call) => call.arguments[1].headers["X-BAPI-SIGN"]));
  });

  it("only fetches the last 30 days after a successful import", async (t) => {
    let startTime;
    const fetch = mock.method(globalThis, "fetch", async (url, init) => {
      const ok = (result) => Response.json({ retCode: 0, retMsg: "OK", result });
      if (url.endsWith("/registertime")) return ok({ registerTime: "1" });
      if (url.endsWith("/batch_create")) {
        startTime = JSON.parse(init.body).startTime;
        return ok({ batchId: "b2" });
      }
      return ok({
        items: [{ type: "CARD", number: "1", status: 2, url: '{"Basepath":"","Files":[]}' }],
      });
    });
    t.after(() => fetch.mock.restore());
    const config = {
      actual: { serverURL: "x", password: "p", syncId: "s", dataDir: "./temp_data_test" },
      bybit: { apiKey: "k", apiSecret: "s", importFrom: "1970-01-01", actualAccount: "A" },
    };
    await importBybit(config, fakeApi({ accounts: [{ id: "A" }] }));
    const thirtyDaysAgo = (Date.now() - 30 * 86_400_000) / 1000;
    assert.ok(Math.abs(startTime - thirtyDaysAgo) < 600, `startTime ${startTime}`);
  });

  it("fails clearly when Bybit rejects the key", async (t) => {
    const fetch = mock.method(globalThis, "fetch", async () =>
      Response.json({ retCode: 10005, retMsg: "Permission denied" }),
    );
    t.after(() => fetch.mock.restore());
    const config = {
      actual: { serverURL: "x", password: "p", syncId: "s", dataDir: "./temp_data_test" },
      bybit: { apiKey: "k", apiSecret: "s", importFrom: "1970-01-01", actualAccount: "A" },
    };
    await assert.rejects(importBybit(config, fakeApi()), /Permission denied \(10005\)/);
  });
});

describe("loadConfig bybit", () => {
  const env = {
    ACTUAL_SERVER_URL: "https://actual.example",
    ACTUAL_SERVER_PASSWORD: "secret",
    ACTUAL_SYNC_ID: "sync-id",
    ENABLE_BYBIT: "true",
    BYBIT_API_KEY: "k",
    BYBIT_API_SECRET: "s",
    BYBIT_ACTUAL_ACCOUNT: "A",
  };

  it("can run Bybit alone", () => {
    const config = loadConfig(env);
    assert.deepEqual(config.bybit, {
      apiKey: "k",
      apiSecret: "s",
      importFrom: "1970-01-01",
      actualAccount: "A",
      transferAccount: null,
    });
    assert.equal(config.coverflex, null);
  });

  it("requires the key, secret and account", () => {
    assert.throws(() => loadConfig({ ...env, BYBIT_API_SECRET: "" }), /BYBIT_API_SECRET/);
  });
});
