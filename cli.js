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

    if (command === "import-myendenred") {
        await importMyEdenredTransactions();
    } else if (command === "import-coverflex") {
        await importCoverflexTransactions();
    } 
    process.exit();
};
