const {  getConf } = require("./config.js");
const { importMyEdenredTransactions, importCoverflexTransactions } = require("./engine.js");

let config;

/**
 * 
 * @param {string} command 
 * @param {object} flags 
 * @param {string} flags.since
 */
module.exports = async (command, flags) => {
    if (!command) {
        console.log('Try "mealcards --help"');
        process.exit();
    }

    config = getConf(flags.user || "default")

    if (command === "config") {
        console.log(`Config for this app is located at: ${config.path}`);
    } else if (command === "import-myendenred") {
        await importMyEdenredTransactions();
    } else if (command === "import-coverflex") {
        await importCoverflexTransactions();
    } 
    process.exit();
};
