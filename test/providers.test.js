import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
