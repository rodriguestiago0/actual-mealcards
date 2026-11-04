// Preloaded (node --import) into the CLI and scheduler in test/entrypoints.test.js so they run
// offline: every request fails with 401 after FETCH_STUB_DELAY_MS, logging when it starts and ends.
const delay = Number(process.env.FETCH_STUB_DELAY_MS ?? 0);

globalThis.fetch = async (url) => {
  const path = new URL(url).pathname;
  process.stderr.write(`fetch-stub start ${path}\n`);
  await new Promise((resolve) => setTimeout(resolve, delay));
  process.stderr.write(`fetch-stub end ${path}\n`);
  return new Response("denied", { status: 401 });
};
