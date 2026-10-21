import { requestJson } from "../http.js";

const BASE_URL = "https://menhir-api.coverflex.com/api/employee";

async function authenticate({ username, password, userAgentToken }) {
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
  const json = await requestJson(`${BASE_URL}/movements?pocket_id=${pocketId}&pagination=no`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return json?.movements?.list ?? [];
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

export async function getTransactions(coverflexConfig, pocketId) {
  const token = await authenticate(coverflexConfig);
  const movements = await fetchMovements(token, pocketId);
  return mapTransactions(movements, coverflexConfig.importFrom);
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
  return trusted.user_agent_token;
}
