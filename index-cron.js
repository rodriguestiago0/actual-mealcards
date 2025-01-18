const { importMyEdenredTransactions, importCoverflexTransactions } = require("./engine.js");
var cron = require('node-cron');
const parser = require('cron-parser');
const { getAppConfigFromEnv } = require("./config");

const appConfig = getAppConfigFromEnv();

var cronExpression = "0 0 */4 * * *";
if (appConfig.CRON_EXPRESSION != "") {
    cronExpression = appConfig.CRON_EXPRESSION
}
console.info("Defined cron is: ", cronExpression)
const interval = parser.parseExpression(cronExpression);
console.info('Next run:', interval.next().toISOString());

if (appConfig.ENABLE_EDENRED) {
    console.info('Import for My Edenred enabled');
}

if (appConfig.ENABLE_COVERFLEX) {
    console.info('Import Coverflex enabled');
}

cron.schedule(cronExpression, async () => {
    if (appConfig.ENABLE_EDENRED) {
        console.info('Importing My Edenred');
        try{
            await importMyEdenredTransactions();
        } catch (e) {
            console.error(e)
        }
    }
    if (appConfig.ENABLE_COVERFLEX) {
        console.info('Importing Coverflex');
        try{
            await importCoverflexTransactions();
        } catch (e) {
            console.error(e)
        }
    }
    console.info('Next run:', interval.next().toISOString());
});

