const { getAppConfigFromEnv } = require("./config");
const crypto = require('crypto');

const appConfig = getAppConfigFromEnv();


const authenticate = async () => {
    u = {
      userId: appConfig.EDENRED_USERNAME,
      password: appConfig.EDENRED_PIN,
      appType: "IOS",
      appVersion: "4.1.0"
    };
    const token = await fetch('https://www.myedenred.pt/edenred-customer/v2/authenticate/pin?appVersion='+ appConfig.EDENRED_VERSION +'&appType=IOS&channel=MOBILE', {
        method: 'POST',
        body: JSON.stringify(u),
        headers: {
            'Content-type': 'application/json',
            'User-Agent': 'EdenRED/3748 CFNetwork/1496.0.7 Darwin/23.5.0',
        },
    })
        .then((response) => response.json())
        .then((json) => json.data.token)
        .catch((err) => {
            console.error("error occured", err);
            return '';
        });
    return token
}


const getAllTransactions = async (token, accountId) => {

    url = 'https://www.myedenred.pt/edenred-customer/v2/protected/card/' + accountId + '/accountmovement?appVersion=1.0&appType=PORTAL&channel=WEB'
    transactions = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': token
        },
    })
        .then((response) => response.json())
        .then((json) => 
            json.data.movementList)
        .catch((err) => {
            console.error("error occured", err);
        });

    return transactions;
}

async function getTransactions(accountId) {
    authorizationToken = await authenticate()
    transactions = await getAllTransactions(authorizationToken, accountId)
    parsedTransactions = []
    transactions.forEach(transaction => {
        transactionID = crypto.createHash('sha256').update(transaction.transactionName+transaction.transactionDate+transaction.amount).digest('hex'); 

        date = transaction.transactionDate.split("T")[0]
        if (date < appConfig.EDENRED_IMPORT_FROM) {
            return;
        }
        parsedTransactions.push({
            date: date,
            amount: Math.trunc(transaction.amount * 100),
            payee_name: transaction.transactionName,
            imported_payee: transaction.transactionName,
            imported_id: transactionID,
            cleared: true,
        })
    });
    

    return parsedTransactions
}

module.exports = {
    getTransactions
}
