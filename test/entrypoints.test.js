// Spawns the CLI (index.js) and the scheduler (index-cron.js) offline, with a fake environment.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fetchStub = join(root, "test/fixtures/fetch-stub.js");

let cwd;
before(async () => {
  // A cwd without a .env, so a developer's real settings are never loaded.
  cwd = await mkdtemp(join(tmpdir(), "actual-mealcards-entry-"));
});
after(() => rm(cwd, { recursive: true, force: true }));

const edenredEnv = {
  ENABLE_EDENRED: "1",
  ACTUAL_SERVER_URL: "http://127.0.0.1:9",
  ACTUAL_SERVER_PASSWORD: "x",
  ACTUAL_SYNC_ID: "s",
  EDENRED_USERNAME: "u",
  EDENRED_PIN: "1234",
  EDENRED_ACCOUNT: "card",
  EDENRED_ACTUAL_ACCOUNT: "A",
};

/**
 * Runs a script with only the given env, sending SIGTERM once stopWhen(output) first holds for the
 * combined stdout/stderr. Resolves with { code, signal, stdout, stderr, output }.
 */
function run(script, args, env, { stopWhen } = {}) {
  const child = spawn(process.execPath, ["--import", fetchStub, join(root, script), ...args], {
    cwd,
    env: { PATH: process.env.PATH, ACTUAL_DATA_DIR: join(cwd, "data"), ...env },
  });
  const result = { stdout: "", stderr: "", output: "" };
  let stopped = false;
  const collect = (stream) => (chunk) => {
    result[stream] += chunk;
    result.output += chunk;
    if (!stopped && stopWhen?.(result.output)) {
      stopped = true;
      child.kill("SIGTERM");
    }
  };
  child.stdout.on("data", collect("stdout"));
  child.stderr.on("data", collect("stderr"));
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
  return new Promise((resolve) => {
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ ...result, code, signal });
    });
  });
}

describe("CLI (index.js)", () => {
  it("prints usage and exits 1 without a command, 0 with --help", async () => {
    const bare = await run("index.js", [], {});
    assert.equal(bare.code, 1);
    assert.match(bare.stdout, /Usage/);
    const help = await run("index.js", ["--help"], {});
    assert.equal(help.code, 0);
    assert.match(help.stdout, /import-myedenred/);
  });

  it("exits 1 on an unknown command", async () => {
    const { code, stderr } = await run("index.js", ["import-nothing"], edenredEnv);
    assert.equal(code, 1);
    assert.match(stderr, /Unknown command: import-nothing/);
  });

  it("exits 1 with the config error when the environment is incomplete", async () => {
    const { code, stderr } = await run("index.js", ["import-myedenred"], {
      ...edenredEnv,
      EDENRED_PIN: "",
    });
    assert.equal(code, 1);
    assert.match(stderr, /Missing environment variable\(s\): EDENRED_PIN/);
  });

  it("exits 1 when the command's provider isn't enabled", async () => {
    const { code, stderr } = await run("index.js", ["import-coverflex"], edenredEnv);
    assert.equal(code, 1);
    assert.match(stderr, /coverflex import is not enabled/);
  });

  it("exits 1 with the error when the import fails", async () => {
    const { code, stderr } = await run("index.js", ["import-myedenred"], edenredEnv);
    assert.equal(code, 1);
    assert.match(stderr, /POST \/edenred-customer\/v2\/authenticate\/pin failed: 401 denied/);
  });
});

describe("scheduler (index-cron.js)", () => {
  it("refuses an invalid cron expression", async () => {
    const { code, stderr } = await run("index-cron.js", [], {
      ...edenredEnv,
      CRON_EXPRESSION: "every day",
    });
    assert.notEqual(code, 0);
    assert.match(stderr, /Invalid cron expression: "every day"/);
  });

  it("schedules and exits 0 on SIGTERM", async () => {
    const { code, stdout } = await run("index-cron.js", [], edenredEnv, {
      stopWhen: (output) => output.includes("Scheduled ("),
    });
    assert.equal(code, 0);
    assert.match(stdout, /My Edenred import enabled/);
    assert.match(stdout, /Scheduled \(0 0 \*\/4 \* \* \*\), next run: \d{4}-/);
    assert.match(stdout, /Received SIGTERM, stopping/);
  });

  it("lets an import in flight finish before exiting on SIGTERM", async () => {
    const { code, output } = await run(
      "index-cron.js",
      [],
      { ...edenredEnv, RUN_ON_START: "1", FETCH_STUB_DELAY_MS: "500" },
      { stopWhen: (output) => output.includes("fetch-stub start") },
    );
    assert.equal(code, 0);
    const order = ["Received SIGTERM", "fetch-stub end", "Edenred import failed"];
    const positions = order.map((text) => output.indexOf(text));
    assert.ok(
      positions.every((pos, i) => pos >= 0 && (i === 0 || pos > positions[i - 1])),
      output,
    );
  });

  it("never overlaps RUN_ON_START with a cron tick", async () => {
    // A tick every second while each import takes 1.2s: ticks fire during the running import.
    const { code, output } = await run(
      "index-cron.js",
      [],
      {
        ...edenredEnv,
        RUN_ON_START: "1",
        CRON_EXPRESSION: "* * * * * *",
        FETCH_STUB_DELAY_MS: "1200",
      },
      { stopWhen: (output) => output.split("Edenred import failed").length > 2 },
    );
    assert.equal(code, 0);
    const events = output.match(/fetch-stub (start|end)/g);
    assert.ok(events.length >= 4, output);
    events.forEach((event, i) =>
      assert.equal(event, i % 2 ? "fetch-stub end" : "fetch-stub start"),
    );
  });
});
