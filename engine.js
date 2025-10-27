const { getAppConfigFromEnv, getConf } = require("./config");
const edenredService = require("./edenredService.js");
const coverflexService = require("./coverflexService.js");
const { initialize, importTransactions, finalize  } = require("./actual.js");

const appConfig = getAppConfigFromEnv();
const readline = require("readline");
config = getConf("default")

async function importMyEdenredTransactions() {
    const actual = await initialize(config);
    edenredMapping = appConfig.EDENRED_ACCOUNT_MAPPING
    for (let [edenredAccountId, actualAccountID] of Object.entries(edenredMapping)) {
        console.info("Importing my edenred transactions for account ", edenredAccountId)
        var mappedtransactions = await edenredService.getTransactions(edenredAccountId)
        if (mappedtransactions.length == 0) {
            console.info("No imported transactions");
            continue;
        }
        await importTransactions(actual, actualAccountID, mappedtransactions);
    };
   
    await finalize(actual);
}


async function importCoverflexTransactions() {
    const actual = await initialize(config);
    converflexMapping = appConfig.COVERFLEX_ACCOUNT_MAPPING
    for (let [coverflexAccountID, actualAccountID] of Object.entries(converflexMapping)) {
        console.info("Importing coverflex transactions for account ", coverflexAccountID)
        var mappedtransactions = await coverflexService.getTransactions(coverflexAccountID)
        if (mappedtransactions.length == 0) {
            console.info("No imported transactions");
            continue;
        }
        await importTransactions(actual, actualAccountID, mappedtransactions);
    };
   
    await finalize(actual);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            resolve(answer);
        });
    });
}

async function getCoverflexToken() {
    if (!appConfig.ENABLE_COVERFLEX) {
        throw new Error(`Coverflex import not enabled`);
    }

    u = {
        email: appConfig.COVERFLEX_USERNAME,
        password: appConfig.COVERFLEX_PASSWORD,
    };

    const first_login = await fetch('https://menhir-api.coverflex.com/api/employee/sessions', {
        method: 'POST',
        body: JSON.stringify(u),
        headers: {
            'Content-type': 'application/json'
        },
    });

        // wait until user types OTP
        const otp = await askQuestion('Enter your otp code: ');

        rl.close();

        const response = await fetch('https://menhir-api.coverflex.com/api/employee/sessions', {
            method: 'POST',
            body: JSON.stringify({ ...u, otp }),
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const json = await response.json();
        token = json.token || '';

        bearerToken = 'Bearer ' + token;
        const trust_device = await fetch('https://menhir-api.coverflex.com/api/employee/sessions/trust-user-agent', {
                method: 'POST',
                headers: {
                    'Authorization': bearerToken
                },
            });

        const trust_response = await trust_device.json();
        console.log("Your COVERFLEX_USER_AGENT_TOKEN is:", trust_response.user_agent_token);
        }


module.exports = {
    importMyEdenredTransactions,
    importCoverflexTransactions,
    getCoverflexToken
}
