import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "actual-mealcards-cli-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("CLI imports", () => {
  it("use a private budget copy, removed on exit, not ACTUAL_DATA_DIR", async () => {
    const tmp = mkdtempSync(join(dir, "tmp-"));
    const dataDir = join(dir, "data");
    const run = promisify(execFile)(
      process.execPath,
      [
        "--import",
        join(root, "test/fixtures/edenred-stub.js"),
        join(root, "index.js"),
        "import-myedenred",
      ],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          TMPDIR: tmp,
          ENABLE_EDENRED: "1",
          ACTUAL_SERVER_URL: "http://127.0.0.1:9",
          ACTUAL_SERVER_PASSWORD: "x",
          ACTUAL_SYNC_ID: "s",
          ACTUAL_DATA_DIR: dataDir,
          EDENRED_USERNAME: "u",
          EDENRED_PIN: "1234",
          EDENRED_ACCOUNT: "card",
          EDENRED_ACTUAL_ACCOUNT: "A",
        },
      },
    );
    const { stderr, code } = await run.then(
      () => ({ code: 0 }),
      (err) => err,
    );
    assert.equal(code, 1);
    assert.match(stderr, /Actual Budget error/);
    // The copy existed while Actual was asked for the budget, and is gone after.
    assert.match(stderr, /tmpdir: actual-mealcards-\w+/);
    assert.deepEqual(readdirSync(tmp), []);
    assert.equal(existsSync(dataDir), false);
  });
});
