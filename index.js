#!/usr/bin/env node
const meow = require("meow");
const myedenred = require("./cli.js");

const cli = meow(
    `
  Usage
    $ mealcards <command> <flags>

  Commands & Options
    import-myendenred   Sync MyEndenred accounts to Actual Budget
    import-coverflex    Sync Coverflex accounts to Actual Budget
    get-coverflex-token Login on Coverflex Account and return User Agent Token
    config              Print the location of myedenredactual the config file

  Examples
    $ mealcards import-myendenred
`);

myedenred(cli.input[0], cli.flags);

