const { getAppConfigFromEnv } = require("./config");
const crypto = require('crypto');

const appConfig = getAppConfigFromEnv();
const readline = require("readline");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// helper to turn rl.question into a promise
function askQuestion(query) {
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            resolve(answer);
        });
    });
}

const authenticate = async () => {
    u = {
        email: appConfig.COVERFLEX_USERNAME,
        password: appConfig.COVERFLEX_PASSWORD,
        user_agent_token: appConfig.COVERFLEX_USER_AGENT_TOKEN
    };

    const first_login = await fetch('https://menhir-api.coverflex.com/api/employee/sessions', {
        method: 'POST',
        body: JSON.stringify(u),
        headers: {
            'Content-type': 'application/json'
        },
    });

    if (first_login.ok) {
        // wait until user types OTP
        const otp = await askQuestion('Enter your otp code: ');

        rl.close();

        const token = await fetch('https://menhir-api.coverflex.com/api/employee/sessions', {
            method: 'POST',
            body: JSON.stringify({ ...u, otp }),
            headers: {
                'Content-type': 'application/json'
            },
        })
            .then((response) => response.json())
            .then((json) =>
                json.token)
            .catch((err) => {
                console.error("error occured", err);
                return '';
            });

        return token;
    }

}


const getAllTransactions = async (token, accountId) => {

    url = 'https://menhir-api.coverflex.com/api/employee/movements?pocket_id=' + accountId + '&pagination=no'
    bearerToken = 'Bearer ' + token;
    transactions = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': bearerToken
        },
    })
        .then((response) => response.json())
        .then((json) =>
            json.movements.list)
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
        date = transaction.executed_at.split("T")[0]
        if (date < appConfig.COVERFLEX_IMPORT_FROM) {
            return;
        }
        amount = transaction.amount.amount;
        if (transaction.is_debit) {
            amount = amount * -1;
        }
        parsedTransactions.push({
            date: date,
            amount: amount,
            payee_name: transaction.description,
            imported_payee: transaction.description,
            imported_id: transaction.id,
            cleared: transaction.status == "confirmed",
        })
    });

    return parsedTransactions
}

module.exports = {
    getTransactions
}
