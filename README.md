# Actual Meal Cards

Imports transactions from prepaid meal cards into [Actual Budget](https://actualbudget.org).
Supported providers: **My Edenred** (Portugal) and **Coverflex**. Run an import once from the
command line or on a schedule, either with Node.js or with Docker (see
[README.Docker.md](README.Docker.md)).

## Quick start

1. Requires Node.js 22+. Clone this repo and run `npm ci`.
2. In Actual, create one account per card. The first import has no starting balance, so add it
   to the account yourself.
3. Copy `.env.sample` to `.env` and set:
   - `ACTUAL_SERVER_URL` and `ACTUAL_SERVER_PASSWORD`
   - `ACTUAL_SYNC_ID`, found in Actual under **Settings → Show advanced settings → Sync ID**
   - `ACTUAL_FILE_PASSWORD`, only if the budget uses end-to-end encryption
4. Set up at least one provider: [My Edenred](#my-edenred) or [Coverflex](#coverflex).
5. Run one import: `node index.js import-myedenred` or `node index.js import-coverflex`. Import on
   a schedule: `npm start`.

`node index.js -h` lists the commands. The budget is cached in `ACTUAL_DATA_DIR` (default
`./temp_data_actual`).

## Account mapping

Each provider account maps to an Actual account through a pair of variables. The Actual account ID
is in the app's URL when you open the account (`/accounts/<ID>`).

| Provider account    | Actual account             |
| ------------------- | -------------------------- |
| `EDENRED_ACCOUNT`   | `EDENRED_ACTUAL_ACCOUNT`   |
| `COVERFLEX_ACCOUNT` | `COVERFLEX_ACTUAL_ACCOUNT` |

For more cards, add pairs with a `_1`, `_2`, ... suffix (e.g. `EDENRED_ACCOUNT_1` /
`EDENRED_ACTUAL_ACCOUNT_1`). Numbering stops at the first incomplete pair.

To skip older history, set `EDENRED_IMPORT_FROM` / `COVERFLEX_IMPORT_FROM` (`YYYY-MM-DD`). The
default, `1970-01-01`, imports everything.

## My Edenred

Set `ENABLE_EDENRED=true` and fill in:

| Variable           | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| `EDENRED_USERNAME` | Your Edenred user ID: a GUID, **not** your email address               |
| `EDENRED_PIN`      | The PIN you use in the app                                             |
| `EDENRED_ACCOUNT`  | Your card ID                                                           |
| `EDENRED_VERSION`  | App version sent to Edenred (default `4.1.0`); raise it if login fails |

### Get the user ID and card ID

The app doesn't show these, so capture them from the mobile app's traffic with an HTTPS proxy
(e.g. [Proxyman](https://proxyman.io) on iOS):

- **User ID:** the `userId` in the body of the `POST .../authenticate/pin` request
- **Card ID:** the `<ID>` in the path of `GET .../protected/card/<ID>/accountmovement`

### Caveats

- Every movement is imported as cleared, including pending ones. If Edenred later drops a pending
  movement, delete it in Actual yourself.
- Edenred movements have no ID, so the importer derives one from the name, time and amount. If one
  of those changes when a movement settles, the settled movement is imported as a new transaction.
- Identical movements (same name, time and amount) are imported as separate transactions.

## Coverflex

Set `ENABLE_COVERFLEX=true` and fill in `COVERFLEX_USERNAME` (your email), `COVERFLEX_PASSWORD`,
`COVERFLEX_ACCOUNT` and `COVERFLEX_ACTUAL_ACCOUNT`. Imports also need `COVERFLEX_USER_AGENT_TOKEN`,
which you generate with a command:

### Get the user agent token

The token lets imports log in without an OTP. Set every variable above, plus the Actual variables
(and the Edenred ones, if Edenred is enabled); the token itself can still be empty. Then run:

```bash
node index.js get-coverflex-token
# or, in Docker:
docker exec -it actual-mealcards node index.js get-coverflex-token
```

Enter the OTP code Coverflex sends you, then set the printed token as `COVERFLEX_USER_AGENT_TOKEN`.
In the 30 days before it expires, every Coverflex import logs a warning and, if
[notifications](#notifications) are set up, sends a reminder (at most once a day).

### Get the account ID

Log in to Coverflex in a browser and open the developer tools' Network tab. Find the request to
`https://menhir-api.coverflex.com/api/employee/movements` and copy the value of its `pocket_id`
query parameter.

### Caveats

- Only confirmed movements are imported as cleared; pending ones are imported as uncleared.
- Cancelled movements are deleted from Actual automatically.

## Scheduling

`npm start` runs every enabled import on `CRON_EXPRESSION`. The default, `0 0 */4 * * *`, runs
every 4 hours; the expression takes 6 fields, the first being seconds. Imports never overlap. Set
`RUN_ON_START=true` to also import once at startup.

## Notifications

You get a message when a scheduled import fails (imports run from the command line don't send
one), and the Coverflex token reminder.

Set `NOTIFICATION_URL` to one or more space-separated URLs. They use the same format as
[Watchtower](https://containrrr.dev/watchtower/notifications/) (Shoutrrr), so you can reuse existing
Watchtower URLs:

| Service  | URL                                                                           |
| -------- | ----------------------------------------------------------------------------- |
| Telegram | `telegram://BOT_TOKEN@telegram?chats=CHAT_ID[,CHAT_ID]`                       |
| Discord  | `discord://TOKEN@WEBHOOK_ID`                                                  |
| Slack    | `slack://hook:T-B-X@webhook` (from `https://hooks.slack.com/services/T/B/X`)  |
| Email    | `smtp://USER:PASSWORD@HOST:PORT/?from=ADDRESS&to=ADDRESS[,ADDRESS]`           |
| ntfy     | `ntfy://[USER:PASSWORD@]HOST/TOPIC`                                           |
| Gotify   | `gotify://HOST/APP_TOKEN`                                                     |
| Webhook  | `generic+https://HOST/PATH` (POSTs JSON `{"title": "...", "message": "..."}`) |

Telegram also accepts `channels=` instead of `chats=`, as older Watchtower URLs use it.

URL-encode special characters in credentials (e.g. `@` → `%40`). Email uses implicit TLS on port
465 and STARTTLS on other ports; set `encryption=None` to disable it. For plain-HTTP servers, add
`?scheme=http` (ntfy) or `?disabletls=yes` (Gotify).

## Logs

Output is timestamped. The Actual API's own verbose logging is hidden unless `DEBUG=1`.

## Development

`npm run lint`, `npm run format`, `npm test`. Release process: [RELEASING.md](RELEASING.md).
