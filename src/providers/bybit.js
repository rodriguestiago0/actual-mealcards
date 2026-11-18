import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { formatDate } from "../actual.js";
import { requestJson } from "../http.js";
import { log } from "../log.js";

// Bybit EU has no card transactions endpoint for personal keys, so movements come from its tax
// export: an asynchronous report of CSV files, requested, polled and then downloaded.
const BASE_URL = "https://api.bybit.eu";
const RECV_WINDOW = "5000";
const REPORTS = [
  { type: "CARD", number: "1" },
  { type: "DEPOSIT&WITHDRAWAL", number: "3" },
  { type: "BONUS", number: "2" },
  { type: "DEPOSIT&WITHDRAWAL", number: "4" },
];
// The export takes at most 12 months per request.
const MAX_RANGE_DAYS = 360;
export const DAY_MS = 86_400_000;
// Bybit EU didn't exist before, so never look further back, even if Bybit can't say when the
// account was opened.
const EARLIEST_MS = Date.UTC(2024, 0, 1);
// Waits before retrying a GET after a network error, a timeout or a 5xx, signed again each time:
// Bybit rejects a signature older than the receive window.
const RETRY_DELAYS_MS = [1_000, 5_000];
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
// The internal transfer list takes at most 7 days per request, and 50 transfers per page.
const TRANSFER_RANGE_DAYS = 7;
const TRANSFER_PAGE_SIZE = 50;
// The account the card spends from and deposits land in.
const FUNDING = "FUND";

/** The X-BAPI-* headers of a signed request; payload is the JSON body or the query string. */
export function signedHeaders({ apiKey, apiSecret }, payload, now = Date.now()) {
  const timestamp = String(now);
  const sign = createHmac("sha256", apiSecret)
    .update(timestamp + apiKey + RECV_WINDOW + payload)
    .digest("hex");
  return {
    "X-BAPI-API-KEY": apiKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-RECV-WINDOW": RECV_WINDOW,
    "X-BAPI-SIGN": sign,
    "X-BAPI-SIGN-TYPE": "2",
  };
}

async function call(credentials, method, path, params = {}) {
  let url = BASE_URL + path;
  let payload;
  if (method === "GET") {
    payload = new URLSearchParams(params).toString();
    url += `?${payload}`;
  } else {
    payload = JSON.stringify(params);
  }
  const delays = method === "GET" ? RETRY_DELAYS_MS : [];
  let json;
  for (let attempt = 0; ; attempt++) {
    try {
      // requestJson serializes the body itself; JSON.stringify is deterministic, so it signs the same.
      json = await requestJson(
        url,
        {
          method,
          headers: signedHeaders(credentials, payload),
          body: method === "GET" ? undefined : params,
        },
        { retryDelaysMs: [] },
      );
      break;
    } catch (err) {
      if (attempt >= delays.length || err.status < 500) throw err;
      log.warn(`Bybit ${path} failed (${err.message}), retrying`);
      await sleep(delays[attempt]);
    }
  }
  if (json?.retCode !== 0) {
    throw new Error(`Bybit ${path} failed: ${json?.retMsg || "no message"} (${json?.retCode})`);
  }
  return json.result;
}

/** [start, end) ranges in Unix seconds covering fromMs..toMs, each within the export's limit. */
export function exportRanges(fromMs, toMs) {
  const ranges = [];
  for (let start = fromMs; start < toMs; start += MAX_RANGE_DAYS * DAY_MS) {
    const end = Math.min(start + MAX_RANGE_DAYS * DAY_MS, toMs);
    ranges.push([Math.floor(start / 1000), Math.floor(end / 1000)]);
  }
  return ranges;
}

/** Requests one export of every report and returns { "TYPE:NUMBER": [file URLs] }. */
async function exportReports(credentials, [startTime, endTime], { pollIntervalMs, pollTimeoutMs }) {
  const { batchId } = await call(
    credentials,
    "POST",
    "/v5/fht/compliance/tax/private/batch_create",
    {
      startTime,
      endTime,
      items: REPORTS,
      exportFileType: "csv",
    },
  );

  const deadline = Date.now() + pollTimeoutMs;
  for (;;) {
    const { items } = await call(credentials, "GET", "/v5/fht/compliance/tax/private/batch_query", {
      batchId,
    });
    const failed = items.filter((item) => item.status === -1);
    if (failed.length > 0) {
      const names = failed.map((item) => `${item.type}:${item.number}`).join(", ");
      throw new Error(`Bybit export ${batchId} failed for ${names}`);
    }
    if (items.length > 0 && items.every((item) => item.status === 2)) {
      return Object.fromEntries(
        items.map((item) => {
          const { Basepath, Files } = JSON.parse(item.url);
          const files = Files.filter((file) => file.endsWith(".csv"));
          return [`${item.type}:${item.number}`, files.map((file) => Basepath + file)];
        }),
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(`Bybit export ${batchId} wasn't ready after ${pollTimeoutMs / 1000}s`);
    }
    await sleep(pollIntervalMs);
  }
}

async function downloadText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Bybit export download failed: ${response.status}`);
  }
  return response.text();
}

/** Parses RFC 4180 CSV (quoted fields may hold commas, quotes and newlines) into objects. */
export function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...records] = rows.filter((r) => r.length > 1 || r[0] !== "");
  if (!header) return [];
  return records.map((record) => Object.fromEntries(header.map((name, i) => [name, record[i]])));
}

async function downloadRows(urls) {
  const rows = [];
  for (const url of urls) rows.push(...parseCsv(await downloadText(url)));
  return rows;
}

/** Integer cents from a decimal string such as "394.030000000000000000", or NaN. */
function toCents(value) {
  if (!/^-?\d+(\.\d+)?$/.test(value?.trim() ?? "")) return NaN;
  return Math.round(Number(value) * 100);
}

// Card rows that never move money on their own: authorizations (a DEDUCT follows when they
// settle), their reversals and refund requests (a REFUND follows).
const IGNORED_CARD_TYPES = new Set(["FREEZE", "UNFREEZE", "REFUND_REQUEST"]);

const AUTHORIZATION_MAX_DAYS = 10;

/**
 * For each purchase, the date of the authorization it settled from: the latest unused successful
 * one at the same merchant for the same amount, at most 10 days earlier. The export doesn't link
 * them, and the authorization date is the day of the payment, a day or more before it settles.
 */
function authorizationDates(rows) {
  const day = (row) => row["Transaction Date & Time"]?.slice(0, 10) ?? "";
  const key = (row) => `${row["Merchant Name"]}|${toCents(row["Transaction Amount"])}`;
  const open = new Map();
  for (const row of rows) {
    if (row.Type !== "FREEZE" || row.Status !== "SUCCESS") continue;
    if (!open.has(key(row))) open.set(key(row), []);
    open.get(key(row)).push(day(row));
  }
  for (const days of open.values()) days.sort();

  const dates = new Map();
  const purchases = rows
    .filter((row) => row.Type === "DEDUCT")
    .sort((a, b) => (day(a) < day(b) ? -1 : 1));
  for (const row of purchases) {
    const days = open.get(key(row)) ?? [];
    const settled = Date.parse(day(row));
    const index = days.findLastIndex((date) => {
      const gap = (settled - Date.parse(date)) / 86_400_000;
      return gap >= 0 && gap <= AUTHORIZATION_MAX_DAYS;
    });
    if (index === -1) continue;
    dates.set(row["Transaction ID"], days[index]);
    days.splice(index, 1);
  }
  return dates;
}

/**
 * Card rows to import: settled purchases, dated by their authorization when found, and settled
 * refunds, in the account's currency. Rows that can't be read are described in `skipped`.
 */
export function mapCardRows(rows, importFrom, skipped = []) {
  const authorized = authorizationDates(rows);
  const transactions = [];
  for (const row of rows) {
    const type = row.Type;
    // Pending rows are left for a later run: the import never updates them once added.
    if (IGNORED_CARD_TYPES.has(type) || row.Status !== "SUCCESS") continue;

    const id = row["Transaction ID"];
    const date = authorized.get(id) ?? row["Transaction Date & Time"]?.slice(0, 10);
    const cents = toCents(row["Transaction Amount"]);
    const known = type === "DEDUCT" || type === "REFUND";
    if (!known || !id || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || Number.isNaN(cents)) {
      skipped.push(`card ${type ?? "?"} ${id ?? "?"} ${date ?? "?"}`);
      continue;
    }
    if (date < importFrom) continue;

    const merchant = row["Merchant Name"]?.trim() || "Bybit Card";
    const transaction = {
      date,
      amount: type === "DEDUCT" ? -cents : cents,
      payee_name: merchant,
      imported_payee: merchant,
      imported_id: id,
      cleared: true,
    };
    const paid = row["Payment Currency"];
    if (paid && paid !== row.Currency) {
      const fee = toCents(row["Total Fee"]);
      transaction.notes =
        `${Number(row["Payment Amount"]).toFixed(2)} ${paid}` +
        (fee > 0 ? `, fee ${(fee / 100).toFixed(2)} ${row.Currency}` : "");
    }
    transactions.push(transaction);
  }
  return transactions;
}

/**
 * Fiat deposit rows to import: deposits as inflows, and refunded deposits (money sent back to the
 * bank) as outflows. Rows that can't be read, or of a type not seen yet, are described in
 * `skipped`.
 */
export function mapDepositRows(rows, importFrom, skipped = []) {
  const transactions = [];
  for (const row of rows) {
    const id = row.OrderID;
    // Deposits still in progress have no completion time yet; refunds can have none at all.
    if (row.Type === "DEPOSIT" && !Number(row.CompletedTime)) continue;
    const time = Number(row.CompletedTime) || Number(row.OrderTime);
    const cents = toCents(row.FinalAmount);
    const sign = { DEPOSIT: 1, REFUND: -1 }[row.Type];
    if (!sign || !id || !time || row.Fiat !== "EUR" || Number.isNaN(cents)) {
      skipped.push(`deposit ${row.Type ?? "?"} ${id ?? "?"}`);
      continue;
    }
    const date = formatDate(new Date(time));
    if (date < importFrom) continue;

    const method = row.PaymentMethods?.replaceAll("_", " ") || "Bank";
    const payee = row.Type === "DEPOSIT" ? `${method} deposit` : `${method} deposit refund`;
    transactions.push({
      date,
      amount: sign * cents,
      payee_name: payee,
      imported_payee: payee,
      imported_id: id,
      cleared: true,
    });
  }
  return transactions;
}

/**
 * Euro transfers between the Funding account and Bybit's other accounts (e.g. to buy crypto in the
 * Unified account), which neither export lists, as inflows and outflows of the Funding account.
 * `counterparty` names the other Bybit account. Transfers that aren't done yet are left for later.
 */
export function mapInternalTransfers(transfers, importFrom, skipped = []) {
  const transactions = [];
  for (const transfer of transfers) {
    if (transfer.status !== "SUCCESS") continue;
    const id = transfer.transferId;
    const time = Number(transfer.timestamp);
    const cents = toCents(transfer.amount);
    const incoming = transfer.toAccountType === FUNDING;
    if (!incoming && transfer.fromAccountType !== FUNDING) continue;
    if (!id || !time || Number.isNaN(cents)) {
      skipped.push(`transfer ${id ?? "?"}`);
      continue;
    }
    const date = formatDate(new Date(time));
    if (date < importFrom) continue;

    const counterparty = incoming ? transfer.fromAccountType : transfer.toAccountType;
    const payee = `Bybit ${counterparty[0]}${counterparty.slice(1).toLowerCase()}`;
    transactions.push({
      date,
      amount: incoming ? cents : -cents,
      payee_name: payee,
      imported_payee: payee,
      imported_id: id,
      cleared: true,
      counterparty,
    });
  }
  return transactions;
}

/** Every euro transfer between Bybit accounts from fromMs to toMs. */
async function getInternalTransfers(credentials, fromMs, toMs) {
  const transfers = [];
  for (let start = fromMs; start < toMs; start += TRANSFER_RANGE_DAYS * DAY_MS) {
    const endTime = Math.min(start + TRANSFER_RANGE_DAYS * DAY_MS, toMs);
    let cursor = "";
    for (;;) {
      const params = { coin: "EUR", startTime: start, endTime, limit: TRANSFER_PAGE_SIZE };
      if (cursor) params.cursor = cursor;
      const result = await call(
        credentials,
        "GET",
        "/v5/asset/transfer/query-inter-transfer-list",
        params,
      );
      const page = result?.list ?? [];
      transfers.push(...page);
      // Bybit returns a cursor even on the last page, so a short page is the end.
      if (page.length < TRANSFER_PAGE_SIZE || !result.nextPageCursor) break;
      cursor = result.nextPageCursor;
    }
  }
  return transfers;
}

/**
 * Euro bonuses (e.g. campaign rewards) to import as inflows. The report has no ids, so each is
 * identified by its time, amount and position among identical ones.
 */
export function mapBonusRows(rows, importFrom, skipped = []) {
  const transactions = [];
  const seen = new Map();
  for (const row of rows) {
    if (row.Coin !== "EUR") continue;
    const time = Number(row.CompletedTime);
    const cents = toCents(row.FinalAmount);
    if (!time || Number.isNaN(cents)) {
      skipped.push(`bonus ${row.CompletedTime ?? "?"}`);
      continue;
    }
    const key = `${time}-${cents}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const date = formatDate(new Date(time));
    if (date < importFrom) continue;

    transactions.push({
      date,
      amount: cents,
      payee_name: "Bybit bonus",
      imported_payee: "Bybit bonus",
      imported_id: `bonus-${key}-${n}`,
      cleared: true,
    });
  }
  return transactions;
}

/**
 * Express orders that sold crypto for euros (e.g. 1.17 USDC for 1.00 EUR) as inflows. Other kinds
 * aren't known yet, so they're described in `skipped` rather than guessed.
 */
export function mapExpressRows(rows, importFrom, skipped = []) {
  const transactions = [];
  for (const row of rows) {
    const id = row.OrderID;
    // Orders still in progress, or that failed, have no completion time.
    if (!Number(row.CompletedTime)) continue;
    const time = Number(row.CompletedTime);
    const cents = toCents(row.FinalAmount);
    if (
      row.Side !== "sell" ||
      row.DestinationCoin !== "EUR" ||
      !id ||
      !time ||
      Number.isNaN(cents)
    ) {
      skipped.push(`express order ${row.Side ?? "?"} ${id ?? "?"}`);
      continue;
    }
    const date = formatDate(new Date(time));
    if (date < importFrom) continue;

    const payee = `Bybit ${row.Fiat} sale`;
    transactions.push({
      date,
      amount: cents,
      payee_name: payee,
      imported_payee: payee,
      imported_id: `express-${id}`,
      cleared: true,
      notes: `${Number(row.DepositAmount)} ${row.Fiat}`,
    });
  }
  return transactions;
}

/** The date the Bybit account was opened, in ms, or null when Bybit doesn't say. */
async function registeredAt(credentials) {
  const result = await call(credentials, "POST", "/fht/compliance/tax/v3/private/registertime");
  const seconds = Number(result?.registerTime);
  return seconds > 0 ? seconds * 1000 : null;
}

const isoDay = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * Card, fiat deposit, bonus, crypto sale and internal transfer transactions since importFrom,
 * fetched from `since` (ms) when given, and never from before the account was opened, so the
 * default 1970-01-01 doesn't request decades of empty exports. Each export takes minutes to
 * prepare, so all of them are requested at once.
 */
export async function getTransactions(
  credentials,
  importFrom,
  skipped = [],
  {
    since = 0,
    pollIntervalMs = POLL_INTERVAL_MS,
    pollTimeoutMs = POLL_TIMEOUT_MS,
    now = Date.now(),
  } = {},
) {
  const from = Math.max(
    Date.parse(`${importFrom}T00:00:00Z`),
    since,
    ((await registeredAt(credentials)) ?? 0) - DAY_MS,
    EARLIEST_MS,
  );
  // Exports start earlier so purchases settled from importFrom find their authorization.
  const exportFrom = from - AUTHORIZATION_MAX_DAYS * DAY_MS;
  // The end is exclusive and rounded down to a UTC day, so end tomorrow to include today.
  const to = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;

  const [transfers, ...exports] = await Promise.all([
    getInternalTransfers(credentials, from, to),
    ...exportRanges(exportFrom, to).map(async (range) => {
      log.info(`Requesting Bybit export ${isoDay(range[0])} to ${isoDay(range[1])}`);
      const files = await exportReports(credentials, range, { pollIntervalMs, pollTimeoutMs });
      return {
        card: await downloadRows(files["CARD:1"] ?? []),
        deposits: await downloadRows(files["DEPOSIT&WITHDRAWAL:3"] ?? []),
        bonuses: await downloadRows(files["BONUS:2"] ?? []),
        sales: await downloadRows(files["DEPOSIT&WITHDRAWAL:4"] ?? []),
      };
    }),
  ]);

  const transactions = [
    // Deduplicated first, so a row in two exports doesn't use up a second authorization.
    ...mapCardRows(
      [...new Map(exports.flatMap((e) => e.card).map((r) => [r["Transaction ID"], r])).values()],
      importFrom,
      skipped,
    ),
    ...mapDepositRows(
      exports.flatMap((e) => e.deposits),
      importFrom,
      skipped,
    ),
    // Numbered per export: identical bonuses in one export are distinct, across two the same.
    ...exports.flatMap((e) => mapBonusRows(e.bonuses, importFrom, skipped)),
    ...mapExpressRows(
      exports.flatMap((e) => e.sales),
      importFrom,
      skipped,
    ),
    ...mapInternalTransfers(transfers, importFrom, skipped),
  ];
  // Adjacent exports can both hold a row from the day they meet.
  return [...new Map(transactions.map((t) => [t.imported_id, t])).values()];
}
