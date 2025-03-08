const Conf = require("conf");
const config = require("dotenv").config;
config();

const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || "";
const ACTUAL_SERVER_PASSWORD = process.env.ACTUAL_SERVER_PASSWORD || "";
const ACTUAL_FILE_PASSWORD = process.env.ACTUAL_FILE_PASSWORD || "";

const APP_PORT = process.env.APP_PORT || 3000;

const APP_URL = process.env.APP_URL || "http://localhost"

const EDENRED_VERSION = process.env.EDENRED_VERSION || "4.1.0";
const EDENRED_USERNAME = process.env.EDENRED_USERNAME || "";
const EDENRED_PIN = process.env.EDENRED_PIN || "";
const EDENRED_ACCOUNT = process.env.EDENRED_ACCOUNT || "";
const EDENRED_ACTUAL_ACCOUNT = process.env.EDENRED_ACTUAL_ACCOUNT || "";
const CRON_EXPRESSION = process.env.CRON_EXPRESSION || "";
const ACTUAL_SYNC_ID = process.env.ACTUAL_SYNC_ID || "";
const EDENRED_IMPORT_FROM = process.env.EDENRED_IMPORT_FROM || "1970-01-01";


const COVERFLEX_USERNAME = process.env.COVERFLEX_USERNAME || "";
const COVERFLEX_PASSWORD = process.env.COVERFLEX_PASSWORD || "";
const COVERFLEX_USER_AGENT_TOKEN = process.env.COVERFLEX_USER_AGENT_TOKEN || "";
const COVERFLEX_IMPORT_FROM = process.env.IMPORT_FROM || "1970-01-01";

const COVERFLEX_ACCOUNT = process.env.COVERFLEX_ACCOUNT || "";
const COVERFLEX_ACTUAL_ACCOUNT = process.env.COVERFLEX_ACTUAL_ACCOUNT || "";

const ENABLE_EDENRED = stringToBoolean(process.env.ENABLE_EDENRED);
const ENABLE_COVERFLEX = stringToBoolean(process.env.ENABLE_COVERFLEX);

function stringToBoolean(stringValue){
    switch(stringValue?.toLowerCase()?.trim()){
        case "true": 
        case "yes": 
        case "1": 
          return true;

        case "false": 
        case "no": 
        case "0": 
        case null: 
        case undefined:
          return false;

        default: 
          return JSON.parse(stringValue);
    }
}

function validateEnv(variables){
    // Assert that all required environment variables are set
    Object.entries(variables).forEach(([key, value]) => {
        if (!value) {
            throw new Error(`Missing environment variable: ${key}`);
        }
    })
}

function getAppConfigFromEnv() {
    if (!ENABLE_COVERFLEX && !ENABLE_EDENRED) {
        throw new Error(`Both meal cards importers are disabled`);
    }
    validateEnv({
        APP_PORT,
        APP_URL,
        ACTUAL_SERVER_URL,
        ACTUAL_SERVER_PASSWORD,
        ACTUAL_SYNC_ID,
        CRON_EXPRESSION,
    })

    var EDENRED_ACCOUNT_MAPPING = {};
    var COVERFLEX_ACCOUNT_MAPPING = {};

    if (ENABLE_EDENRED) {
        if (!EDENRED_ACCOUNT){
            throw new Error(`Missing environment variable: EDENRED_ACCOUNT`);
        }
        if (!EDENRED_ACTUAL_ACCOUNT){
            throw new Error(`Missing environment variable: EDENRED_ACTUAL_ACCOUNT`);
        }
        
        EDENRED_ACCOUNT_MAPPING[EDENRED_ACCOUNT] = EDENRED_ACTUAL_ACCOUNT;

        var i = 1;
        while(true){
            edenredAccount = process.env[`EDENRED_ACCOUNT_${i}`] || "";
            actualAccount = process.env[`EDENRED_ACTUAL_ACCOUNT_${i}`] || "";
            if (!edenredAccount || !actualAccount) {
                break;
            }
            i++;
            EDENRED_ACCOUNT_MAPPING[edenredAccount] = actualAccount;
        }

        validateEnv({
            EDENRED_USERNAME,
            EDENRED_PIN,
            EDENRED_VERSION
        });
    }

    
    if (ENABLE_COVERFLEX) {
        if (!COVERFLEX_ACCOUNT){
            throw new Error(`Missing environment variable: COVERFLEX_ACCOUNT`);
        }
        if (!COVERFLEX_ACTUAL_ACCOUNT){
            throw new Error(`Missing environment variable: COVERFLEX_ACTUAL_ACCOUNT`);
        }
        COVERFLEX_ACCOUNT_MAPPING[COVERFLEX_ACCOUNT] = COVERFLEX_ACTUAL_ACCOUNT;
        var i = 1;
        while(true){
            coverflexAccount = process.env[`COVERFLEX_ACCOUNT_${i}`] || "";
            actualAccount = process.env[`COVERFLEX_ACTUAL_ACCOUNT_${i}`] || "";
            if (!coverflexAccount || !actualAccount) {
                break;
            }
            i++;
            COVERFLEX_ACCOUNT_MAPPING[coverflexAccount] = actualAccount;
        }
        
        validateEnv({
            COVERFLEX_USERNAME,
            COVERFLEX_PASSWORD,
            COVERFLEX_USER_AGENT_TOKEN
        });
    }

    const appConfig = {
        APP_PORT,
        APP_URL,
        ACTUAL_SERVER_URL,
        ACTUAL_SERVER_PASSWORD,
        ACTUAL_FILE_PASSWORD,
        ACTUAL_SYNC_ID,
        CRON_EXPRESSION,
        EDENRED_ACCOUNT_MAPPING,
        EDENRED_IMPORT_FROM,
        EDENRED_USERNAME,
        EDENRED_PIN,
        EDENRED_VERSION,
        COVERFLEX_ACCOUNT_MAPPING,
        COVERFLEX_USERNAME,
        COVERFLEX_PASSWORD,
        COVERFLEX_USER_AGENT_TOKEN,
        COVERFLEX_IMPORT_FROM,
        ENABLE_EDENRED,
        ENABLE_COVERFLEX
    }

    return appConfig
}


function getConf(username) {
    const appConfig = getAppConfigFromEnv();
    const key = `${username}`;

    const tmp = new Conf({
        configName: key
    });
    tmp.set("user", key);
    tmp.set("budget_id", appConfig.ACTUAL_SYNC_ID)
    return tmp;
}

module.exports = {
    getAppConfigFromEnv,
    getConf
}
