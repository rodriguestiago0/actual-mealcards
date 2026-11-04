import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import * as coverflex from "../src/providers/coverflex.js";
import * as edenred from "../src/providers/edenred.js";

describe("edenred.mapTransactions", () => {
  const movements = [
    { transactionName: "Old", transactionDate: "2024-01-01T10:00:00", amount: -1 },
    { transactionName: "Cafe", transactionDate: "2024-12-02T09:30:00", amount: -4.35 },
    { transactionName: "Top-up", transactionDate: "2024-12-01T00:00:00", amount: 160.6 },
  ];

  it("filters by date and converts amounts to integer cents without float loss", () => {
    const result = edenred.mapTransactions(movements, "2024-12-01");
    assert.deepEqual(
      result.map(({ date, amount, payee_name }) => ({ date, amount, payee_name })),
      [
        { date: "2024-12-02", amount: -435, payee_name: "Cafe" },
        { date: "2024-12-01", amount: 16060, payee_name: "Top-up" },
      ],
    );
  });

  // Changing these ids would import every Edenred movement again for existing users.
  it("keeps the imported_id format of existing imports", () => {
    const cafe = movements[1];
    assert.deepEqual(
      edenred.mapTransactions([cafe, cafe], "1970-01-01").map((t) => t.imported_id),
      [
        "ba501667fcf2b3fdb6f81afa58b61d2076931ef767a872892b713418b0954ce0",
        "4b84d972e94d6c44a797fbfa2d3b86c5fbaacbac5e4f255174a0fefb244a2461",
      ],
    );
  });

  it("derives a stable imported_id", () => {
    const [first] = edenred.mapTransactions(movements.slice(1, 2), "1970-01-01");
    const [second] = edenred.mapTransactions(movements.slice(1, 2), "1970-01-01");
    assert.match(first.imported_id, /^[0-9a-f]{64}$/);
    assert.equal(first.imported_id, second.imported_id);
  });
});

describe("coverflex.mapTransactions", () => {
  const movement = (overrides) => ({
    id: "m1",
    executed_at: "2024-12-02T12:00:00Z",
    amount: { amount: 850 },
    is_debit: true,
    status: "confirmed",
    description: "Lunch",
    ...overrides,
  });

  it("signs debits, marks confirmed as cleared and splits out cancelled ids", () => {
    const { transactions, cancelledIds } = coverflex.mapTransactions(
      [
        movement(),
        movement({ id: "m2", is_debit: false, status: "pending", description: "Top-up" }),
        movement({ id: "m3", status: "cancelled" }),
        movement({ id: "m4", executed_at: "2020-01-01T00:00:00Z" }),
      ],
      "2024-01-01",
    );

    assert.deepEqual(transactions, [
      {
        date: "2024-12-02",
        amount: -850,
        payee_name: "Lunch",
        imported_payee: "Lunch",
        imported_id: "m1",
        cleared: true,
      },
      {
        date: "2024-12-02",
        amount: 850,
        payee_name: "Top-up",
        imported_payee: "Top-up",
        imported_id: "m2",
        cleared: false,
      },
    ]);
    assert.deepEqual(cancelledIds, ["m3"]);
  });
});

describe("coverflex.mapTransactions dates", () => {
  it("books movements on the local day, keeping bare dates as they are", (t) => {
    const tz = process.env.TZ;
    process.env.TZ = "Europe/Lisbon";
    t.after(() => {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    });
    const movement = (id, executed_at) => ({
      id,
      executed_at,
      amount: { amount: 850 },
      is_debit: true,
      status: "confirmed",
      description: "Lunch",
    });
    const { transactions } = coverflex.mapTransactions(
      [
        movement("summer", "2024-07-01T23:30:00Z"),
        movement("winter", "2024-12-01T23:30:00Z"),
        movement("offset", "2024-07-01T00:30:00+01:00"),
        movement("bare", "2024-07-01"),
      ],
      "1970-01-01",
    );
    assert.deepEqual(
      transactions.map((t) => [t.imported_id, t.date]),
      [
        ["summer", "2024-07-02"],
        ["winter", "2024-12-01"],
        ["offset", "2024-07-01"],
        ["bare", "2024-07-01"],
      ],
    );
  });
});

describe("edenred.mapTransactions duplicates", () => {
  it("keeps identical movements apart, with the first keeping the legacy id", () => {
    const movement = {
      transactionName: "Cafe",
      transactionDate: "2024-12-02T09:30:00",
      amount: -1,
    };
    const [single] = edenred.mapTransactions([movement], "1970-01-01");
    const [first, second] = edenred.mapTransactions([movement, { ...movement }], "1970-01-01");
    assert.equal(first.imported_id, single.imported_id);
    assert.notEqual(second.imported_id, first.imported_id);
  });
});

describe("coverflex.tokenExpiry", () => {
  const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

  it("reads the exp claim", () => {
    assert.deepEqual(
      coverflex.tokenExpiry(jwt({ exp: 1_824_727_788 })),
      new Date(1_824_727_788_000),
    );
  });

  it("returns null for unreadable tokens", () => {
    assert.equal(coverflex.tokenExpiry("not-a-jwt"), null);
    assert.equal(coverflex.tokenExpiry(jwt({})), null);
  });
});

describe("coverflex.getUserAgentToken", () => {
  it("fails when Coverflex doesn't return a user agent token", async (t) => {
    const fetch = mock.method(globalThis, "fetch", async (url) =>
      Response.json(url.endsWith("/trust-user-agent") ? {} : { token: "session" }),
    );
    t.after(() => fetch.mock.restore());
    await assert.rejects(
      coverflex.getUserAgentToken({ username: "u", password: "p" }, async () => "123456"),
      /no user agent token/,
    );
  });
});

describe("coverflex.countStatuses", () => {
  it("counts movements per status", () => {
    const movements = [{ status: "confirmed" }, { status: "pending" }, { status: "confirmed" }, {}];
    assert.deepEqual(coverflex.countStatuses(movements), {
      confirmed: 2,
      pending: 1,
      undefined: 1,
    });
  });
});

describe("movements response shape", () => {
  function mockFetch(t, body) {
    const fetch = mock.method(globalThis, "fetch", async () => Response.json(body));
    t.after(() => fetch.mock.restore());
  }

  it("fails instead of importing nothing when the movements list is missing", async (t) => {
    mockFetch(t, { data: {} });
    await assert.rejects(
      edenred.getTransactions("tok", "card", "1970-01-01"),
      /Edenred: unexpected movements response/,
    );
    mockFetch(t, { movements: { items: [] } });
    await assert.rejects(
      coverflex.getTransactions("tok", "pocket", "1970-01-01"),
      /Coverflex: unexpected movements response/,
    );
  });

  it("accepts an empty list", async (t) => {
    mockFetch(t, { data: { movementList: [] } });
    assert.deepEqual(await edenred.getTransactions("tok", "card", "1970-01-01"), []);
  });
});

describe("malformed movements", () => {
  it("skips Edenred movements without a date or numeric amount, keeping the rest", () => {
    const skipped = [];
    const result = edenred.mapTransactions(
      [
        { transactionName: "Cafe", transactionDate: "2024-12-02T09:30:00", amount: -4.35 },
        { transactionName: "No date", amount: -1 },
        { transactionName: "Text", transactionDate: "2024-12-02T10:00:00", amount: "-1" },
        null,
      ],
      "1970-01-01",
      skipped,
    );
    assert.deepEqual(
      result.map((t) => t.payee_name),
      ["Cafe"],
    );
    assert.deepEqual(skipped, [
      "movement 2: no valid transactionDate",
      "movement 3: no numeric amount",
      "movement 4: no valid transactionDate",
    ]);
  });

  it("skips Coverflex movements without an id, date or integer amount, keeping the rest", () => {
    const valid = {
      id: "m1",
      executed_at: "2024-12-02T12:00:00Z",
      amount: { amount: 850 },
      is_debit: true,
      status: "confirmed",
      description: "Lunch",
    };
    const skipped = [];
    const { transactions } = coverflex.mapTransactions(
      [
        valid,
        { ...valid, id: undefined },
        { ...valid, id: "m3", executed_at: null },
        { ...valid, id: "m4", amount: { amount: "850" } },
        { ...valid, id: "m5", amount: { amount: 8.5 } },
      ],
      "1970-01-01",
      skipped,
    );
    assert.deepEqual(
      transactions.map((t) => t.imported_id),
      ["m1"],
    );
    assert.deepEqual(skipped, [
      "movement 2: no id",
      "movement 3: m3: no valid executed_at",
      "movement 4: m4: no integer amount",
      "movement 5: m5: no integer amount",
    ]);
  });
});
