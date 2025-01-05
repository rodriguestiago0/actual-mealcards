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
    config              Print the location of myedenredactual the config file

  Examples
    $ mealcards import-myendenred
`);

myedenred(cli.input[0], cli.flags);

