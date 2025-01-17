### Building and running your application

When you're ready, start your application by running:
`docker compose up --build`.

Docker-comple.yaml example:
```
version: '3'
services:
  actual_mealcards:
    container_name: actual_mealcards
    image: docker.io/rodriguestiago0/actual_mealcards
    environment:
      - PUID=1003
      - PGID=100
      - TZ=Europe/Lisbon
      - EDENRED_USERNAME= 
      - EDENRED_PIN= 
      - EDENRED_VERSION= # default 4.1.0
      - EDENRED_ACCOUNT=
      - EDENRED_ACTUAL_ACCOUNT=
      - EDENRED_ACCOUNT_1=
      - EDENRED_ACTUAL_ACCOUNT_1=
      - ACTUAL_SERVER_URL= 
      - ACTUAL_SERVER_PASSWORD=
      - ACTUAL_FILE_PASSWORD=
      - ACTUAL_SYNC_ID=
      - CRON_EXPRESSION= # default value is "0 */4 * * *"
      - COVERFLEX_USERNAME=
      - COVERFLEX_PASSWORD=
      - COVERFLEX_USER_AGENT_TOKEN=
      - COVERFLEX_IMPORT_FROM=
      - COVERFLEX_ACCOUNT=
      - COVERFLEX_ACTUAL_ACCOUNT=
      - COVERFLEX_ACCOUNT_1=
      - COVERFLEX_ACTUAL_ACCOUNT_1=
    restart: unless-stopped
```

```
docker run -d --name actual_mealcards \
    -e 'EDENRED_USERNAME=' \
    -e 'EDENRED_PIN=' \
    -e 'EDENRED_VERSION=' \
    -e 'EDENRED_ACCOUNT=' \
    -e 'ACTUAL_ACCOUNT=' \
    -e 'EDENRED_ACCOUNT_1=' \
    -e 'ACTUAL_ACCOUNT_1=' \
    -e 'ACTUAL_SERVER_URL= ' \
    -e 'ACTUAL_SERVER_PASSWORD=' \
    - 'ACTUAL_FILE_PASSWORD=' \
    -e 'ACTUAL_SYNC_ID=' \
    -e CRON_EXPRESSION= # default value is "0 */4 * '* *"' \
    -e COVERFLEX_USERNAME= \
    -e COVERFLEX_PASSWORD= \
    -e COVERFLEX_USER_AGENT_TOKEN= \
    -e COVERFLEX_IMPORT_FROM= \
    -e COVERFLEX_ACCOUNT= \
    -e COVERFLEX_ACTUAL_ACCOUNT= \
    -e COVERFLEX_ACCOUNT_1= \
    -e COVERFLEX_ACTUAL_ACCOUNT_1=
  --restart=on-failure rodriguestiago0/actual_mealcards:latest
```