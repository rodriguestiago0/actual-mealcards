import { createHash } from "node:crypto";
import { requestJson } from "../http.js";

const BASE_URL = "https://www.myedenred.pt/edenred-customer/v2";

async function authenticate({ username, pin, version }) {
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
  return movements
    .map((movement) => ({ movement, date: movement.transactionDate.split("T")[0] }))
    .filter(({ date }) => date >= importFrom)
    .map(({ movement, date }) => ({
      date,
      amount: Math.round(movement.amount * 100),
      payee_name: movement.transactionName,
      imported_payee: movement.transactionName,
      // Edenred has no stable movement id, so derive one from its content.
      imported_id: createHash("sha256")
        .update(movement.transactionName + movement.transactionDate + movement.amount)
        .digest("hex"),
      cleared: true,
    }));
}

export async function getTransactions(edenredConfig, accountId) {
  const token = await authenticate(edenredConfig);
  const movements = await fetchMovements(token, accountId);
  return mapTransactions(movements, edenredConfig.importFrom);
}
