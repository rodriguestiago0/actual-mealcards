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

Or

Fill your .env with `COVERFLEX_USERNAME` and `COVERFLEX_PASSWORD` and set `ENABLE_COVERFLEX` to `true`.

Run the command get-coverflex-token. When asked enter OTP code. Set returned code to `COVERFLEX_USER_AGENT_TOKEN` on .env .

### Setup

- Requires Node.js 22+
- Clone this repo and install dependencies: `npm ci`
- Copy `.env.sample` to `.env` and fill in the blanks
- Run an import: `node index.js import-myedenred` or `node index.js import-coverflex`
- Run on a schedule (`CRON_EXPRESSION`, default every 4 hours): `npm start`, or use `docker-compose.yaml`.
  Set `RUN_ON_START=true` to also import once at startup.

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
