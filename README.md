# QIE AgentPay — Phase 1

Read-only TypeScript/Express API for the QIE Blockchain Hackathon 3.0. The backend uses ethers v6 for EVM address/checksum validation and exact native-token formatting, dotenv for configuration, and Zod for validation. No Telegram bot, AI integration, transaction creation, custody, signing, or deployment is included in this phase.

## Local setup

Use Node.js 24.x and its bundled npm. From the repository root in PowerShell:

```powershell
cd apps/api
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run check
npm.cmd run dev
```

On other shells use `npm` instead of `npm.cmd` and `cp .env.example .env`. `npm.cmd` avoids Windows PowerShell's script execution-policy restriction. Do not overwrite an existing `.env`. All commands run inside `apps/api`; dotenv loads `.env` from the working directory.

For a compiled run:

```powershell
npm.cmd run build
npm.cmd start
```

Scripts: `dev` watches TypeScript; `typecheck` checks source and tests; `test` runs mocked RPC tests with Node's test runner; `build` emits only application code into `dist`; `start` runs the compiled server; `check` runs type checking, tests, and build.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Local bind address |
| `PORT` | `3000` | HTTP port (1–65535) |
| `QIE_RPC_URL` | `https://rpc1testnet.qie.digital/` | HTTP(S) RPC endpoint, no embedded credentials |
| `RPC_TIMEOUT_MS` | `5000` | Total deadline per network/balance operation (100–30000 ms) |

Chain ID **1983** (`0x7bf`) is fixed in source. It cannot be overridden by environment variables. Each network request verifies `eth_chainId`; each balance request verifies it before and after `eth_getBalance`. A wrong chain never produces a successful response. Checks validate what the configured RPC reports; they are not independent cryptographic proof of its honesty.

## Verify locally

With the server running, use a second PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/api/network
Invoke-RestMethod http://127.0.0.1:3000/api/wallet/0x0000000000000000000000000000000000000001/balance
```

- `/health`: HTTP 200, `status: "ok"`. This is process liveness, not RPC readiness; it works during an RPC outage.
- `/api/network`: HTTP 200 with `name: "QIE Testnet"`, `chainId: 1983`, `currency: "QIE"`, after RPC verification.
- `/api/wallet/:address/balance`: HTTP 200 with checksummed `address`, `chainId`, `symbol: "QIE"`, `decimals: 18`, and decimal-string `balanceWei` / `balance`. Balance uses `latest` and varies with chain state; zero is valid. Strings prevent JavaScript number precision loss.
- An invalid address returns HTTP 400 without contacting RPC. ENS names are not accepted; mixed-case addresses must have a valid checksum.

Errors have the shape `{"error":{"code":"RPC_TIMEOUT","message":"QIE RPC request timed out."}}`.

| Status | Codes / meaning |
| --- | --- |
| 400 | `INVALID_ADDRESS`, `UNSUPPORTED_INPUT`, `INVALID_PATH` |
| 404 | `NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED` (only GET is supported) |
| 502 | `RPC_CHAIN_MISMATCH`, `RPC_INVALID_RESPONSE`, `RPC_ERROR`, `RPC_UNAVAILABLE` |
| 504 | `RPC_TIMEOUT` |
| 500 | `INTERNAL_ERROR` (unexpected failure) |

RPC calls have an abort signal plus a total operation deadline, including response-body reading. Upstream error messages and stacks are not returned. Responses are not cached. Tests inject mocked HTTP responses; they never contact QIE or require funds. Tests cover healthy reads, exact balances, invalid addresses, chain mismatch/switching, timeouts, malformed responses, upstream failures, rejected sensitive input and configuration.

## Non-custodial boundary

Only public addresses are accepted. Do not send private keys, seed phrases, signed transactions, or signing requests to this service. There is no request-body parser, secret storage, wallet/signer instance, generic RPC proxy, or write endpoint. All query parameters and request bodies are rejected; non-GET methods return 405. The RPC transport permits only `eth_chainId` and `eth_getBalance`. No request URLs, bodies, or upstream diagnostics are logged by the application. HTTP cannot prevent clients from transmitting unsolicited bytes, but this API does not process, store, or echo them.

## File guide

| File | Purpose |
| --- | --- |
| `.gitignore` | Excludes dependencies, build output, logs, coverage and local secrets; keeps `.env.example` |
| `README.md` | Setup, configuration, endpoint contracts, verification and scope |
| `apps/api/package.json` | Dependency declarations, Node requirement and npm scripts |
| `apps/api/package-lock.json` | Reproducible resolved dependency versions |
| `apps/api/.env.example` | Safe configuration template; contains no secrets |
| `apps/api/tsconfig.json` | Strict TypeScript settings for source and tests |
| `apps/api/tsconfig.build.json` | Production build configuration excluding tests |
| `apps/api/src/config.ts` | Validated environment configuration and fixed QIE chain ID |
| `apps/api/src/errors.ts` | Typed safe HTTP errors |
| `apps/api/src/blockchain/rpc.ts` | Abortable read-only JSON-RPC transport and response validation |
| `apps/api/src/blockchain/service.ts` | Address checks, chain verification, deadline and balance formatting |
| `apps/api/src/app.ts` | App factory, routes, input restrictions and JSON error handling |
| `apps/api/src/server.ts` | dotenv loading, server startup and shutdown |
| `apps/api/test/api.test.ts` | Mocked RPC/API/configuration tests |

Implementation references: [ethers v6 utilities](https://docs.ethers.org/v6/api/utils/) and [Express error handling](https://expressjs.com/en/guide/error-handling/).

Phase 1 stops here. No deployment is configured or performed.
