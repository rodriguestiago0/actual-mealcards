/**
 * Minimal in-memory stand-in for @actual-app/api, recording every call. Return shapes follow the
 * real API; test/actual-api.test.js checks the code against the real one.
 */
export function fakeApi({ transactions = {}, accounts = [] } = {}) {
  const calls = [];
  const record =
    (name, result) =>
    async (...args) => {
      calls.push([name, ...args]);
      return typeof result === "function" ? result(...args) : result;
    };

  return {
    calls,
    init: record("init"),
    downloadBudget: record("downloadBudget"),
    sync: record("sync"),
    shutdown: record("shutdown"),
    getAccounts: record("getAccounts", () => accounts),
    // Like the real API, only returns transactions dated within [startDate, endDate].
    getTransactions: record("getTransactions", (accountId, startDate, endDate) =>
      (transactions[accountId] ?? []).filter((t) => t.date >= startDate && t.date <= endDate),
    ),
    // The real API returns the new transactions' ids, not the transactions.
    importTransactions: record("importTransactions", (accountId, txs) => ({
      errors: [],
      added: txs.map((_, i) => `${accountId}-added-${i}`),
      updated: [],
    })),
    deleteTransaction: record("deleteTransaction"),
  };
}

export const callsTo = (api, name) => api.calls.filter(([call]) => call === name);
