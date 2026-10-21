# Meal cards - actual

This project imports transactions from your prepaid meal cards into Actual Budget.

Supported providers: My Edenred and Coverflex

**My Edenred note**: Pending transactions are imported as cleared. If one is later removed by Edenred, you need to delete it manually in Actual Budget.

# My Edenred

## Get User ID

User ID now is a `GUID` and not your email address.

For `IOS` I used an app called `Proxyman` and checked the request to get the `UserID`. The `PIN` is your app `PIN`.

Enable the import by setting `ENABLE_EDENRED` to `true` and fill in `EDENRED_USERNAME` and `EDENRED_PIN`.

# Coverflex

Set `ENABLE_COVERFLEX` to `true` and fill in `COVERFLEX_USERNAME`, `COVERFLEX_PASSWORD` and
`COVERFLEX_USER_AGENT_TOKEN` (all three are required).

## Get User Agent Token

Run `node index.js get-coverflex-token` (or `docker exec -it actual-mealcards node index.js get-coverflex-token`),
enter the OTP code when asked and set the printed token as `COVERFLEX_USER_AGENT_TOKEN`. You get a
reminder before it expires (see [Notifications](#notifications)).

## Get Account ID

Open Coverflex in your browser, look in the network tab for
`https://menhir-api.coverflex.com/api/employee/movements?` and use its `pocket_id` as `COVERFLEX_ACCOUNT`.

### Setup

- Requires Node.js 22+
- Clone this repo and install dependencies: `npm ci`
- Copy `.env.sample` to `.env` and fill in the blanks
- Run an import: `node index.js import-myedenred` or `node index.js import-coverflex`
- Run on a schedule (`CRON_EXPRESSION`, default every 4 hours): `npm start`, or use `docker-compose.yaml`.
  Set `RUN_ON_START=true` to also import once at startup.
- Limit how far back to import with `EDENRED_IMPORT_FROM` / `COVERFLEX_IMPORT_FROM` (`YYYY-MM-DD`, default `1970-01-01`)
- The budget is cached in `ACTUAL_DATA_DIR` (default `./temp_data_actual`)

## Notifications

You get a message when a scheduled import fails, and a daily reminder in the 30 days before the
Coverflex user agent token expires.

Set `NOTIFICATION_URL` to one or more space-separated URLs. They use the same format as
[Watchtower](https://containrrr.dev/watchtower/notifications/) (Shoutrrr), so existing Watchtower
URLs can be reused:

| Service  | URL                                                                           |
| -------- | ----------------------------------------------------------------------------- |
| Telegram | `telegram://BOT_TOKEN@telegram?chats=CHAT_ID[,CHAT_ID]`                       |
| Discord  | `discord://TOKEN@WEBHOOK_ID`                                                  |
| Slack    | `slack://hook:T-B-X@webhook` (from `https://hooks.slack.com/services/T/B/X`)  |
| Email    | `smtp://USER:PASSWORD@HOST:PORT/?from=ADDRESS&to=ADDRESS[,ADDRESS]`           |
| ntfy     | `ntfy://[USER:PASSWORD@]HOST/TOPIC`                                           |
| Gotify   | `gotify://HOST/APP_TOKEN`                                                     |
| Webhook  | `generic+https://HOST/PATH` (POSTs JSON `{"title": "...", "message": "..."}`) |

Telegram also accepts `channels=` instead of `chats=`, as used by older Watchtower URLs.

URL-encode special characters in credentials (e.g. `@` → `%40`). Email uses implicit TLS on port
465 and STARTTLS otherwise; set `encryption=None` to disable it. Add `?scheme=http` (ntfy) or
`?disabletls=yes` (Gotify) for plain-HTTP servers.

## Logs

Output is timestamped. The Actual API's own verbose logging is hidden unless `DEBUG=1`.

Docker images are published for `linux/amd64`, `linux/arm64` and `linux/arm/v7` (the latter runs
on Node 22).

## Some things worth noting

The initial transaction import does not have a starting balance, so you will need to manually add that to Actual Budget.

You need to manually create the accounts inside Actual, and then map them to the provider accounts
(`*_ACCOUNT` / `*_ACTUAL_ACCOUNT`, plus `*_ACCOUNT_1` / `*_ACTUAL_ACCOUNT_1`, `_2`, ... for extra accounts).

Cancelled Coverflex transactions are removed from Actual automatically.

Identical Edenred movements (same name, time and amount) are imported as separate transactions.

# Commands

```
  Usage
    $ mealcards <command>

  Commands
    import-myedenred     Sync My Edenred accounts to Actual Budget
    import-coverflex     Sync Coverflex accounts to Actual Budget
    get-coverflex-token  Log in to Coverflex with an OTP and print the user agent token
```

# Development

`npm run lint`, `npm run format`, `npm test`.

# Releases

When Dependabot bumps `@actual-app/api`, the PR is auto-merged after CI passes, a new patch
release (`vX.Y.Z` git tag) is created and the Docker image is published to
`rodriguestiago0/actual-mealcards` (`latest`, `X.Y.Z`, `X.Y`). The git tag is the version
source of truth; `package.json` `version` is not updated.

This requires a fine-grained PAT (Contents + Pull requests: read/write) saved as the
**Dependabot** secret `RELEASE_TOKEN`, "Allow auto-merge" enabled, and the `CI` checks
required on `main`.
