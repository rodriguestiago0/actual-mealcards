### Building and running your application

When you're ready, start your application by running:
`docker compose up --build`.

Images are published for `linux/amd64`, `linux/arm64` and `linux/arm/v7` (the latter runs on Node 22).

`docker-compose.yaml` example:

```yaml
services:
  actual-mealcards:
    container_name: actual-mealcards
    image: docker.io/rodriguestiago0/actual-mealcards:latest
    environment:
      - TZ=Europe/Lisbon
      - ACTUAL_SERVER_URL=
      - ACTUAL_SERVER_PASSWORD=
      - ACTUAL_SYNC_ID=
      - ACTUAL_FILE_PASSWORD= # optional, for end-to-end encrypted budgets
      - CRON_EXPRESSION= # default "0 0 */4 * * *"
      - RUN_ON_START=false
      - NOTIFICATION_URL= # optional, e.g. telegram://TOKEN@telegram?chats=CHAT_ID
      - DEBUG= # set to 1 for verbose Actual API logs
      - ENABLE_EDENRED=true
      - EDENRED_USERNAME=
      - EDENRED_PIN=
      - EDENRED_VERSION= # default 4.1.0
      - EDENRED_IMPORT_FROM= # default 1970-01-01
      - EDENRED_ACCOUNT=
      - EDENRED_ACTUAL_ACCOUNT=
      - EDENRED_ACCOUNT_1= # optional extra accounts: _1, _2, ...
      - EDENRED_ACTUAL_ACCOUNT_1=
      - ENABLE_COVERFLEX=true
      - COVERFLEX_USERNAME=
      - COVERFLEX_PASSWORD=
      - COVERFLEX_USER_AGENT_TOKEN=
      - COVERFLEX_IMPORT_FROM= # default 1970-01-01
      - COVERFLEX_ACCOUNT=
      - COVERFLEX_ACTUAL_ACCOUNT=
      - COVERFLEX_ACCOUNT_1= # optional extra accounts: _1, _2, ...
      - COVERFLEX_ACTUAL_ACCOUNT_1=
    restart: unless-stopped
```

`docker run` example:

```bash
docker run -d --name actual-mealcards \
  -e TZ=Europe/Lisbon \
  -e ACTUAL_SERVER_URL= \
  -e ACTUAL_SERVER_PASSWORD= \
  -e ACTUAL_SYNC_ID= \
  -e ACTUAL_FILE_PASSWORD= \
  -e CRON_EXPRESSION="0 0 */4 * * *" \
  -e RUN_ON_START=false \
  -e NOTIFICATION_URL= \
  -e ENABLE_EDENRED=true \
  -e EDENRED_USERNAME= \
  -e EDENRED_PIN= \
  -e EDENRED_ACCOUNT= \
  -e EDENRED_ACTUAL_ACCOUNT= \
  -e ENABLE_COVERFLEX=true \
  -e COVERFLEX_USERNAME= \
  -e COVERFLEX_PASSWORD= \
  -e COVERFLEX_USER_AGENT_TOKEN= \
  -e COVERFLEX_ACCOUNT= \
  -e COVERFLEX_ACTUAL_ACCOUNT= \
  --restart unless-stopped \
  rodriguestiago0/actual-mealcards:latest
```

To get the Coverflex user agent token from the running container:

```bash
docker exec -it actual-mealcards node index.js get-coverflex-token
```
