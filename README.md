# Meal cards - actual

This project will help you import transaction from your Prepaid card into actual budget app.

Supported providers: My Edenred and Coverflex

You need to provide your username and password and specify what the cadence you want to import transactions.

**My Edenred note**: Pending transaction are being imported as cleared. If the transaction is deleted after you need to delete manally from the actual budget.

# My Edenred

## Get User ID
User ID now is a `GUID` and not your email address.

For `IOS` I used an app called `Proxyman` and checked the request to get the `UserID`. The `PIN` is your app `PIN`.

Enabled the import by setting the flag `ENABLE_EDENRED` to `true`.

# Coverflex

## Get User Agent Token
To get the User Agent Token use the network tab of your browser.

Search for `https://menhir-api.coverflex.com/api/employee/movements?` and use the pocket_id as `COVERFLEX_ACCOUNT`

Enabled the import by setting the flag `ENABLE_COVERFLEX` to `true`.

### Setup

-   Clone this repo!
-   Install dependencies: `npm ci`
-   Copy `.sample.env` to `.env` and fill in the blanks
-   Run `import`: `node index.js import-myendenred`, this will import all my endenred transactions to Actual

## Some things worth noting

The intial transaction import does not have a starting balance, so you will need to manually add that to Actual Budget.

You need to manually create the accounts inside Actual, and then map them to the My Edenred accounts.

# Commands


```
  Usage
    $ mealcards <command> <flags>

  Commands & Options
    import-myendenred   Sync MyEndenred accounts to Actual Budget
    import-coverflex    Sync Coverflex accounts to Actual Budget
    config              Print the location of myedenredactual the config file

  Examples
    $ mealcards import-myendenred
```
