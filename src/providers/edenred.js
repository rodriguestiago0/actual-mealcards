import { createHash } from "node:crypto";
import { requestJson } from "../http.js";

const BASE_URL = "https://www.myedenred.pt/edenred-customer/v2";

export async function login({ username, pin, version }) {
  const json = await requestJson(
    `${BASE_URL}/authenticate/pin?appVersion=${version}&appType=IOS&channel=MOBILE`,
    {
      method: "POST",
      headers: { "User-Agent": "EdenRED/3748 CFNetwork/1496.0.7 Darwin/23.5.0" },
      body: { userId: username, password: pin, appType: "IOS", appVersion: version },
    },
  );
  const token = json?.data?.token;
  if (!token) throw new Error("Edenred authentication returned no token");
  return token;
}

async function fetchMovements(token, accountId) {
  const json = await requestJson(
    `${BASE_URL}/protected/card/${accountId}/accountmovement?appVersion=1.0&appType=PORTAL&channel=WEB`,
    { headers: { Authorization: token } },
  );
  return json?.data?.movementList ?? [];
}

export function mapTransactions(movements, importFrom) {
  const seen = new Map();
  return movements
    .map((movement) => ({ movement, date: movement.transactionDate.split("T")[0] }))
    .filter(({ date }) => date >= importFrom)
    .map(({ movement, date }) => {
      // Edenred has no stable movement id, so derive one from its content. Identical movements
      // (same name, time and amount) get an occurrence suffix so they aren't merged into one;
      // the first keeps the unsuffixed id used by earlier versions.
      const key = movement.transactionName + movement.transactionDate + movement.amount;
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      return {
        date,
        amount: Math.round(movement.amount * 100),
        payee_name: movement.transactionName,
        imported_payee: movement.transactionName,
        imported_id: createHash("sha256")
          .update(occurrence === 0 ? key : `${key}#${occurrence}`)
          .digest("hex"),
        cleared: true,
      };
    });
}

export async function getTransactions(token, accountId, importFrom) {
  return mapTransactions(await fetchMovements(token, accountId), importFrom);
}
