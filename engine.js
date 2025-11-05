const { getAppConfigFromEnv } = require("./config");
const edenredService = require("./edenredService.js");
const coverflexService = require("./coverflexService.js");
const { initialize, importTransactions, finalize  } = require("./actual.js");

const appConfig = getAppConfigFromEnv();

async function importMyEdenredTransactions() {
    const actual = await initialize();
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
    const actual = await initialize();
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



module.exports = {
    importMyEdenredTransactions,
    importCoverflexTransactions
}
