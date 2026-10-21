import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

  it("reads COVERFLEX_IMPORT_FROM, falling back to IMPORT_FROM", () => {
    assert.equal(
      loadConfig({ ...coverflexEnv, COVERFLEX_IMPORT_FROM: "2024-11-23" }).coverflex.importFrom,
      "2024-11-23",
    );
    assert.equal(
      loadConfig({ ...coverflexEnv, IMPORT_FROM: "2024-01-01" }).coverflex.importFrom,
      "2024-01-01",
    );
    assert.equal(loadConfig(coverflexEnv).coverflex.importFrom, "1970-01-01");
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
