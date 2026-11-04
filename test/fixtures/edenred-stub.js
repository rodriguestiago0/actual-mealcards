// Preloaded (node --import) into the CLI by test/cli.test.js: Edenred logs in and returns no
// movements, and every other request (Actual's) fails. Prints TMPDIR's entries on each request.
import { readdirSync } from "node:fs";

globalThis.fetch = async (url) => {
  process.stderr.write(`tmpdir: ${readdirSync(process.env.TMPDIR).join(",")}\n`);
  if (String(url).includes("/authenticate/pin")) return Response.json({ data: { token: "t" } });
  return new Response("unavailable", { status: 503 });
};
