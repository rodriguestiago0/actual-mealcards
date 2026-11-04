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

/** Splits movements into transactions to import and Coverflex ids of cancelled ones. */
export function mapTransactions(movements, importFrom) {
  const transactions = [];
  const cancelledIds = [];

  for (const movement of movements) {
    const date = movement.executed_at.split("T")[0];
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
  for (const { status } of movements) {
    const key = String(status);
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

export async function getTransactions(token, pocketId, importFrom) {
  const movements = await fetchMovements(token, pocketId);
  logStatuses(movements);
  return mapTransactions(movements, importFrom);
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
  // The first request triggers the OTP; it is expected to be rejected.
  await requestJson(`${BASE_URL}/sessions`, { method: "POST", body: credentials }).catch(() => {});

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
