# QIE AgentPay Telegram bot — Phase 2

TypeScript/Telegraf bot for **@QIEAgentPayBot**. It reads the existing Phase 1 API, using its actual network, balance and error response formats. There are no payments, real invoices, AI features, database, contracts, wallet signing or deployment in Phase 2.

## Run locally

Use Node.js 24.x. Keep the API and bot in separate terminals.

Terminal 1, from the repository root:

```powershell
cd apps/api
npm.cmd ci
npm.cmd run dev
```

Terminal 2, from the repository root:

```powershell
cd apps/bot
npm.cmd ci
Copy-Item .env.example .env
```

Do not overwrite an existing `.env`. Privately edit **apps/bot/.env** and set `TELEGRAM_BOT_TOKEN` to the token BotFather issued for @QIEAgentPayBot. Do not paste it into chat, source code, shell commands or logs. The root `.gitignore` already ignores `.env` at every directory level. This implementation does not create or read your token during tests.

Keep `API_BASE_URL=http://127.0.0.1:3000`. Then:

```powershell
npm.cmd run check
npm.cmd run dev
```

For a compiled run, stop dev with Ctrl+C first:

```powershell
npm.cmd run build
npm.cmd start
```

On other shells use `npm` and `cp` instead of `npm.cmd` and `Copy-Item`. The bot resolves `.env` relative to its own package, not the terminal's current directory; pre-existing environment variables take precedence.

The bot uses Telegram long polling and needs outbound internet access, but no public server, inbound port or webhook. Run only one instance with this token. Launch removes any existing webhook and drops pending updates so old messages are not processed. Ctrl+C/SIGINT or SIGTERM stops polling and lets current handlers finish; a 15-second deadline bounds shutdown, including a stalled startup. Avoid enabling library debug logging when handling real credentials.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Required | Private BotFather token |
| `API_BASE_URL` | `http://127.0.0.1:3000` | HTTP(S) API origin; no credentials, path, query or fragment |
| `API_TIMEOUT_MS` | `7000` | Total HTTP deadline including response body (100–30000 ms) |

If you increase the API's `RPC_TIMEOUT_MS`, set the bot timeout slightly higher. API timeouts, outages, wrong chains, malformed responses and invalid addresses produce safe, friendly replies. Raw upstream errors and Telegram error objects are not logged or forwarded. The bot has no persistent message or wallet storage and never sends its Telegram token to the backend.

## Test each command

Open https://t.me/QIEAgentPayBot while the local API and bot are running:

| Send | Expected reply |
| --- | --- |
| `/start` | Welcome, scope, non-custodial explanation and secret safety notice |
| `/help` | All five commands |
| `/network` | QIE Testnet, chain ID 1983, native currency QIE |
| `/balance 0x0000000000000000000000000000000000000001` | Address and exact QIE balance; zero is valid |
| `/balance` | Usage hint |
| `/balance invalid` | Invalid-address message; no backend request |
| `/balance <address> extra` | Usage hint; only one address is accepted |
| `/invoice` | Coming soon; no invoice created |

Group commands such as `/balance@QIEAgentPayBot <address>` are supported. Commands addressed to other bots are ignored. Unknown text gets `/help` guidance without being echoed. Only public 0x EVM addresses are accepted, with checksum validation for mixed case; ENS names are not supported. Never send real secrets to test validation.

To check an outage, stop the API and send `/network`: expect a service-unavailable reply. `/start`, `/help` and `/invoice` still work. Restart the API afterward. A wrong token or a second polling instance causes a sanitized startup/polling failure; verify the local configuration without printing it.

## Automated checks and files

`npm.cmd run check` runs source/test type checking, mocked tests, and the production build. Tests mock both backend HTTP responses and Telegram replies; no real token, Telegram messages, API process, RPC connection or funds are required.

| File | Purpose |
| --- | --- |
| `.env.example` | Safe local configuration template |
| `package.json`, `package-lock.json` | Scripts, dependencies and reproducible versions |
| `tsconfig.json` | Strict source/test checking |
| `tsconfig.build.json` | Production-only build into ignored `dist/` |
| `src/config.ts` | Validates configuration without exposing values |
| `src/api.ts` | Typed response validation, EVM addresses, HTTP deadlines and safe errors |
| `src/bot.ts` | Command registration and message formatting |
| `src/main.ts` | dotenv, long polling and graceful shutdown |
| `test/bot.test.ts` | Command routing, mocked API replies, validation, error and timeout tests |

Reference: [Telegraf documentation](https://telegraf.js.org/). Phase 2 stops here.
