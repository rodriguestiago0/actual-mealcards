import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock } from "node:test";
import { collectAccountMapping, loadConfig, stringToBoolean } from "../src/config.js";

const base = {
  ACTUAL_SERVER_URL: "https://actual.example",
  ACTUAL_SERVER_PASSWORD: "secret",
  ACTUAL_SYNC_ID: "sync-id",
};

const coverflexEnv = {
  ...base,
  ENABLE_COVERFLEX: "true",
  COVERFLEX_USERNAME: "user@example.com",
  COVERFLEX_PASSWORD: "pw",
  COVERFLEX_USER_AGENT_TOKEN: "uat",
  COVERFLEX_ACCOUNT: "pocket-0",
  COVERFLEX_ACTUAL_ACCOUNT: "actual-0",
};

describe("stringToBoolean", () => {
  it("parses truthy and falsy values", () => {
    for (const value of ["true", "YES", " 1 "]) assert.equal(stringToBoolean(value), true);
    for (const value of ["false", "no", "0", "", undefined]) {
      assert.equal(stringToBoolean(value), false);
    }
  });

  it("rejects unknown values", () => {
    assert.throws(() => stringToBoolean("maybe"), /Invalid boolean/);
  });
});

describe("collectAccountMapping", () => {
  it("collects the base and numbered pairs until the first gap", () => {
    const mapping = collectAccountMapping(
      {
        X_ACCOUNT: "a",
        X_ACTUAL_ACCOUNT: "A",
        X_ACCOUNT_1: "b",
        X_ACTUAL_ACCOUNT_1: "B",
        X_ACCOUNT_3: "ignored",
        X_ACTUAL_ACCOUNT_3: "ignored",
      },
      "X",
    );
    assert.deepEqual(mapping, { a: "A", b: "B" });
  });

  it("warns about pairs it ignores and repeated accounts", (t) => {
    const write = mock.method(process.stderr, "write", () => true);
    t.after(() => write.mock.restore());
    const mapping = collectAccountMapping(
      {
        X_ACCOUNT: "a",
        X_ACTUAL_ACCOUNT: "A",
        X_ACCOUNT_1: "a",
        X_ACTUAL_ACCOUNT_1: "B",
        X_ACCOUNT_2: "c",
        X_ACTUAL_ACOUNT_2: "typo",
        X_ACCOUNT_3: "d",
        X_ACTUAL_ACCOUNT_3: "D",
        X_ACCOUNT_4: "",
      },
      "X",
    );
    assert.deepEqual(mapping, { a: "B" });
    const warnings = write.mock.calls.map((call) => call.arguments[0]);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /WARN X_ACCOUNT_1 repeats account "a"/);
    assert.match(
      warnings[1],
      /WARN Ignoring X_ACCOUNT_2, X_ACCOUNT_3, X_ACTUAL_ACCOUNT_3: X_ACCOUNT_2 and X_ACTUAL_ACCOUNT_2/,
    );
  });

  it("requires the base pair", () => {
    assert.throws(() => collectAccountMapping({ X_ACCOUNT: "a" }, "X"), /X_ACTUAL_ACCOUNT/);
  });
});

describe("loadConfig", () => {
  it("fails when both importers are disabled", () => {
    assert.throws(() => loadConfig(base), /disabled/);
  });

  it("reports missing Actual settings", () => {
    assert.throws(
      () => loadConfig({ ...coverflexEnv, ACTUAL_SYNC_ID: "" }),
      /Missing environment variable\(s\): ACTUAL_SYNC_ID/,
    );
  });

  it("only configures enabled providers", () => {
    const config = loadConfig(coverflexEnv);
    assert.equal(config.edenred, null);
    assert.deepEqual(config.coverflex.accounts, { "pocket-0": "actual-0" });
    assert.equal(config.cronExpression, "0 0 */4 * * *");
  });

  it("reads COVERFLEX_IMPORT_FROM", () => {
    assert.equal(
      loadConfig({ ...coverflexEnv, COVERFLEX_IMPORT_FROM: "2024-11-23" }).coverflex.importFrom,
      "2024-11-23",
    );
    assert.equal(loadConfig(coverflexEnv).coverflex.importFrom, "1970-01-01");
  });

  it("rejects an IMPORT_FROM that isn't a real YYYY-MM-DD date", () => {
    for (const value of ["2024-1-5", "2024/01/01", "2024-02-31", "yesterday"]) {
      assert.throws(
        () => loadConfig({ ...coverflexEnv, COVERFLEX_IMPORT_FROM: value }),
        new RegExp(`COVERFLEX_IMPORT_FROM must be a date as YYYY-MM-DD, got "${value}"`),
      );
    }
  });

  it("applies Edenred defaults", () => {
    const config = loadConfig({
      ...base,
      ENABLE_EDENRED: "1",
      EDENRED_USERNAME: "u",
      EDENRED_PIN: "1234",
      EDENRED_ACCOUNT: "card",
      EDENRED_ACTUAL_ACCOUNT: "actual",
    });
    assert.equal(config.edenred.version, "4.1.0");
    assert.equal(config.edenred.importFrom, "1970-01-01");
  });
});

describe("loadConfig notifications", () => {
  it("reads RUN_ON_START", () => {
    assert.equal(loadConfig({ ...coverflexEnv, RUN_ON_START: "yes" }).runOnStart, true);
  });

  it("reads REIMPORT_DELETED, off by default", () => {
    assert.equal(loadConfig(coverflexEnv).actual.reimportDeleted, false);
    assert.equal(
      loadConfig({ ...coverflexEnv, REIMPORT_DELETED: "true" }).actual.reimportDeleted,
      true,
    );
  });

  it("parses NOTIFICATION_URL", () => {
    assert.deepEqual(loadConfig(coverflexEnv).notifications, []);
    const config = loadConfig({
      ...coverflexEnv,
      NOTIFICATION_URL: "ntfy://ntfy.sh/a discord://t@1",
    });
    assert.deepEqual(
      config.notifications.map((channel) => channel.name),
      ["ntfy", "discord"],
    );
    assert.throws(() => loadConfig({ ...coverflexEnv, NOTIFICATION_URL: "x://y" }), /unsupported/);
  });
});

describe("secret files", () => {
  it("reads <SECRET>_FILE without the final newline", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "actual-mealcards-secret-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "password");
    writeFileSync(file, "s3cret \n");
    const config = loadConfig({
      ...coverflexEnv,
      ACTUAL_SERVER_PASSWORD: "",
      ACTUAL_SERVER_PASSWORD_FILE: file,
    });
    assert.equal(config.actual.password, "s3cret ");
  });

  it("rejects a secret set both ways, or an unreadable file", () => {
    assert.throws(
      () => loadConfig({ ...coverflexEnv, ACTUAL_SERVER_PASSWORD_FILE: "/x" }),
      /Set ACTUAL_SERVER_PASSWORD or ACTUAL_SERVER_PASSWORD_FILE, not both/,
    );
    assert.throws(
      () =>
        loadConfig({ ...coverflexEnv, COVERFLEX_PASSWORD: "", COVERFLEX_PASSWORD_FILE: "/nope" }),
      /Can't read COVERFLEX_PASSWORD_FILE: ENOENT/,
    );
  });
});
