import { formatDate } from "../actual.js";
import { requestJson } from "../http.js";
import { log } from "../log.js";

const BASE_URL = "https://menhir-api.coverflex.com/api/employee";

export async function login({ username, password, userAgentToken }) {
  if (!userAgentToken) {
    throw new Error("Missing COVERFLEX_USER_AGENT_TOKEN; run `mealcards get-coverflex-token`");
  }
  const json = await requestJson(`${BASE_URL}/sessions`, {
    method: "POST",
    body: { email: username, password, user_agent_token: userAgentToken },
  });
  if (!json?.token) throw new Error("Coverflex authentication returned no token");
  return json.token;
}

async function fetchMovements(token, pocketId) {
  const json = await requestJson(
    `${BASE_URL}/movements?pocket_id=${encodeURIComponent(pocketId)}&pagination=no`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const list = json?.movements?.list;
  // An unofficial API: a changed response shape must fail, not import nothing every run.
  if (!Array.isArray(list)) throw new Error("Coverflex: unexpected movements response");
  return list;
}

/**
 * The calendar day of an executed_at timestamp in local time (the container's TZ), so a lunch paid
 * just after midnight isn't booked on the previous (UTC) day. A bare date is taken as is.
 */
function localDate(executedAt) {
  return executedAt.includes("T") ? formatDate(new Date(executedAt)) : executedAt.slice(0, 10);
}

/** Why a movement can't be imported, or null. Actual rejects a whole batch on a bad amount. */
function invalidReason(movement) {
  if (typeof movement?.id !== "string" || !movement.id) return "no id";
  const { executed_at } = movement;
  if (!/^\d{4}-\d{2}-\d{2}/.test(executed_at) || Number.isNaN(Date.parse(executed_at))) {
    return `${movement.id}: no valid executed_at`;
  }
  if (!Number.isInteger(movement.amount?.amount)) return `${movement.id}: no integer amount`;
  return null;
}

/**
 * Splits movements into transactions to import and Coverflex ids of cancelled ones. Malformed
 * movements are left out and described in skipped, so one bad movement doesn't block the rest.
 */
export function mapTransactions(movements, importFrom, skipped = []) {
  const transactions = [];
  const cancelledIds = [];

  for (const [index, movement] of movements.entries()) {
    const reason = invalidReason(movement);
    if (reason) {
      skipped.push(`movement ${index + 1}: ${reason}`);
      continue;
    }
    const date = localDate(movement.executed_at);
    if (date < importFrom) continue;

    if (movement.status === "cancelled") {
      cancelledIds.push(movement.id);
      continue;
    }

    const amount = movement.amount.amount;
    transactions.push({
      date,
      amount: movement.is_debit ? -amount : amount,
      payee_name: movement.description,
      imported_payee: movement.description,
      imported_id: movement.id,
      cleared: movement.status === "confirmed",
    });
  }
  return { transactions, cancelledIds };
}

// Statuses the mapping knows; "pending" and "confirmed" are imported, "cancelled" is removed.
const KNOWN_STATUSES = new Set(["pending", "confirmed", "cancelled"]);

/** Counts movements per status, e.g. { confirmed: 12, pending: 1 }. */
export function countStatuses(movements) {
  const counts = {};
  for (const movement of movements) {
    const key = String(movement?.status);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Logs the statuses Coverflex returned (only status names and counts, no movement data) so the
 * real set can be confirmed from the logs. Unknown statuses are still imported as uncleared.
 */
function logStatuses(movements) {
  const counts = countStatuses(movements);
  log.info("Coverflex movement statuses:", counts);
  const unknown = Object.keys(counts).filter((status) => !KNOWN_STATUSES.has(status));
  if (unknown.length > 0) {
    log.warn(`Unknown Coverflex status(es) ${unknown.join(", ")}; imported as uncleared`);
  }
}

export async function getTransactions(token, pocketId, importFrom, skipped) {
  const movements = await fetchMovements(token, pocketId);
  logStatuses(movements);
  return mapTransactions(movements, importFrom, skipped);
}

/** Expiry date of a user agent token (a JWT), or null when it can't be read. */
export function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

/** Logs in with an OTP and trusts this device, returning a long-lived user agent token. */
export async function getUserAgentToken({ username, password }, askOtp) {
  const credentials = { email: username, password };
  // The first request triggers the OTP, and Coverflex rejects it with a 4xx. Anything else (a
  // network error, a 5xx) means no OTP is coming, so say so instead of waiting for one.
  try {
    await requestJson(`${BASE_URL}/sessions`, { method: "POST", body: credentials });
  } catch (err) {
    if (!(err.status >= 400 && err.status < 500)) {
      throw new Error(`Coverflex login failed, so no OTP was sent: ${err.message}`, { cause: err });
    }
    log.debug(`Coverflex asked for an OTP (${err.status}):`, err.body);
  }

  const otp = await askOtp();
  const session = await requestJson(`${BASE_URL}/sessions`, {
    method: "POST",
    body: { ...credentials, otp },
  });
  if (!session?.token) throw new Error("Coverflex OTP login returned no token");

  const trusted = await requestJson(`${BASE_URL}/sessions/trust-user-agent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!trusted?.user_agent_token) throw new Error("Coverflex returned no user agent token");
  return trusted.user_agent_token;
}
