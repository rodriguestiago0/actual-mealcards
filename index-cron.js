const { importMyEdenredTransactions, importCoverflexTransactions } = require("./engine.js");
var cron = require('node-cron');
const parser = require('cron-parser');
const { getAppConfigFromEnv } = require("./config");
const { config } = require("dotenv");

const appConfig = getAppConfigFromEnv();

var cronExpression = "0 0 */4 * * *";
if (appConfig.CRON_EXPRESSION != "") {
    cronExpression = appConfig.CRON_EXPRESSION
}
console.info("Defined cron is: ", cronExpression)
const interval = parser.parseExpression(cronExpression);
console.info('Next run:', interval.next().toISOString());

cron.schedule(cronExpression, async () => {
    if (config.ENABLE_EDENRED) {
        console.info('Importing My Edenred');
        try{
            await importMyEdenredTransactions();
        } catch (e) {
            console.error(e)
        }
    }
    if (config.ENABLE_COVERFLEX) {
        console.info('Importing Coverflex');
        try{
            await importCoverflexTransactions();
        } catch (e) {
            console.error(e)
        }
    }
    console.info('Next run:', interval.next().toISOString());
});

