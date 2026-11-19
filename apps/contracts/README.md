# QIE AgentPay contracts — Phase 3

Isolated native-QIE invoice settlement contracts. The Phase 1 API and Phase 2 bot are unchanged; the bot's /invoice command remains a coming-soon placeholder. This phase does not integrate backend signing, invoices in Telegram, AI, databases or deployments to a public chain.

## Install, compile and test

Use Node.js 24.x. From the repository root:

```powershell
cd apps/contracts
npm.cmd ci
npm.cmd run check
npm.cmd run deploy:local
```

Use npm instead of npm.cmd outside PowerShell. The lockfile fixes dependency versions. npm ci installs the pinned solc 0.8.38 package; compilation uses its local soljson.js through Hardhat custom-compiler support, with no separate compiler download; tests use a local simulated EVM, not QIE RPC, Telegram or any real key. npm run check compiles Solidity, checks TypeScript and runs Hardhat's Node test runner. Individual commands: npm run build, npm run typecheck, npm test.

The toolchain uses Hardhat 3, the official ethers and Node test runner plugins, ethers v6, and OpenZeppelin Contracts 5 ReentrancyGuard. There is no toolbox, Mocha, Chai, database, or upgrade plugin. Solidity is pinned to 0.8.38, optimization is enabled at 200 runs, and the EVM target is Paris to avoid requiring newer opcode support. Actual QIE execution compatibility must still be confirmed before a public deployment.

## Contract API and architecture

QIEInvoicePayments.sol is immutable and has no constructor arguments, owner, admin, pause switch, proxy, withdrawal, refund, cancellation, fee or upgrade path. Invoice terms cannot be edited. Native value is accepted only by payInvoice; ordinary transfers and calls with unknown selectors revert.

| Function | Behavior |
| --- | --- |
| createInvoice(bytes32 invoiceId, address merchant, uint256 amountWei, uint256 expiresAt) | Requires merchant == msg.sender, nonzero merchant/ID/amount, unused ID, and expiresAt strictly after block.timestamp |
| payInvoice(bytes32 invoiceId) payable | Anyone may pay once, strictly before expiry, with exactly amountWei |
| getInvoice(bytes32 invoiceId) view | Returns all invoice fields with effective status; unknown ID reverts |
| getInvoiceStatus(bytes32 invoiceId) view | Returns None (0), Unpaid (1), Paid (2), or Expired (3) |

Stored fields: invoiceId, merchant, amountWei, expiresAt, payer, paidAt, status. Timestamps are Unix seconds and amounts are integer wei (18 decimals for QIE); consumers must use bigint or decimal strings. payer is zero and paidAt is zero until payment. Expiration is computed in the getters; no keeper is necessary. At exactly expiresAt payment fails. A paid invoice remains Paid after expiry.

IDs are globally unique for this contract, including paid and expired invoices. Use unpredictable 32-byte IDs, ideally domain-separated with merchant, chain ID and contract address. IDs alone are not proof of merchant identity: before payment, clients must verify the on-chain merchant, amount, expiration, chain and contract. A third party can reserve a predictable ID for their own invoice but cannot impersonate another merchant or overwrite an invoice. Generate a new ID if one is occupied. Users must submit createInvoice from their own wallet (or their merchant smart wallet); backend relaying without a separate authorization design is intentionally unsupported.

Both mutating functions use the storage-based OpenZeppelin ReentrancyGuard (no transient-storage assumption). Payment checks validity, sets status/payer/time and emits its event before calling the merchant. The full msg.value is sent with a low-level call, permitting contract wallets to receive it. If the merchant reverts, rejects value, runs out of available call gas, or propagates a failed reentry, SettlementFailed reverts the entire transaction: payment state, transferred value and events all roll back. The payer still pays transaction gas. If a malicious receiver catches a rejected reentry, the original valid payment may succeed exactly once.

## Events for future indexing

- InvoiceCreated: indexed invoiceId and merchant; amountWei, expiresAt and createdAt.
- InvoicePaid: indexed invoiceId, merchant and payer; amountWei and paidAt.

Only successful transaction logs are durable. Indexers must handle chain reorganizations and choose a confirmation policy; one mined block is not finality. Use (chain ID, contract address, invoice ID) as the identity across networks/deployments. No indexer or backend integration is implemented here.

## Deployment scripts

### Local only

```powershell
npm.cmd run deploy:local
```

Always connects explicitly to the in-process Hardhat network and checks chain 31337. It deploys only QIEInvoicePayments and prints its address. This chain is ephemeral and disappears when the command exits. Hardhat-generated development accounts are local fixtures; the script does not read or print private keys. No .env is required.

### QIE Testnet — future manual use only

**Do not run this until testnet deployment is explicitly authorized. No public deployment is part of Phase 3.**

For that later deployment, copy .env.example to .env without overwriting an existing file. Configure the deployment key privately in QIE_TESTNET_PRIVATE_KEY (0x plus 64 hex characters), use QIE_TESTNET_RPC_URL=https://rpc1testnet.qie.digital/, and deliberately set CONFIRM_QIE_TESTNET_DEPLOYMENT=true. Do not paste keys into chat or shell commands. A dedicated testnet deployer needs testnet gas funds. The deployer acquires no contract privileges.

Future command, **not executed during implementation**:

```powershell
npm.cmd run deploy:testnet
```

The script refuses to run without opt-in. It queries eth_chainId with a deadline and requires **1983 (0x7bf)** before accessing the key or invoking deployment. It rechecks before submission and pins the signed transaction chain ID to 1983. The provider must report the expected network. HTTPS and no embedded credentials are required. RPC verification trusts the endpoint's report, not an independent proof of chain identity.

Only the deployment script constructs a wallet. No API/bot signing or key access is added. The script prints only a public transaction hash and contract address. Errors are sanitized. If confirmation times out after a hash is printed, inspect the transaction before retrying to avoid duplicate deployment. A single confirmation is used for deployment reporting, not asserted as finality. There is no mainnet deployment script.

## Security assumptions and limitations

- Merchant wallets must accept native QIE. A permanently rejecting merchant makes its invoice unpayable; funds never become an escrow balance.
- There is no dispute resolution, recovery, cancellation, price feed, token support or refund mechanism. Merchant/payer key security remains with those wallets.
- Chain block timestamps determine expiry; do not use second-level timing for critical real-world deadlines.
- Normal successful payments leave no retained funds. EVM forced native transfers (for example selfdestruct or pre-funding a future address) cannot be prevented. Such unrelated funds may remain permanently stranded because there is deliberately no sweep/withdrawal path.
- The contract prevents callback reentry and uses atomic settlement; it cannot ensure a merchant delivers off-chain goods or prevent ID reservation attacks against predictable IDs.
- Tests are local engineering validation, not an independent security audit. Review before handling real value.

## Tests and file guide

Tests cover authorized creation, initial fields, indexed events, impersonation, zero merchant/ID/amount, invalid/equal expiry, duplicate IDs across merchants, missing invoices, zero/under/overpayment, exact transfer and gas accounting, arbitrary payer and self-payment, expiry boundaries, duplicate payment, immutable IDs, contract-wallet callback state, settlement rollback/retry, same/cross-invoice reentry, propagated reentry failure, and rejection of unsolicited value. Mocked deployment-guard tests prove wrong/malformed/unavailable RPC responses cannot reach the deployment/key-access callback.

| File | Purpose |
| --- | --- |
| contracts/QIEInvoicePayments.sol | Production invoice registry and settlement |
| contracts/test/MerchantHarness.sol | Adversarial receiver, local tests only |
| hardhat.config.ts | Local network, compiler and minimal plugins |
| package.json / package-lock.json | Commands and reproducible toolchain |
| tsconfig.json | Strict checking for config, scripts and tests |
| .env.example | Empty key placeholder and default-disabled testnet opt-in |
| scripts/deploy-local.ts | Ephemeral local deployment smoke test |
| scripts/deploy-testnet.ts | Separate guarded future testnet deployment |
| scripts/testnet-guard.ts | Reusable chain check and deployment gate |
| test/payments.test.ts | Local EVM contract tests |
| test/deployment.test.ts | Mocked deployment-gate tests |
| README.md | Architecture, security assumptions and local/future deployment instructions |

Root .gitignore excludes .env files, build artifacts, caches, deployment outputs and the contracts secrets/keystore directories and key files. No secret generation step is included. The root README links here.

References: [Hardhat 3](https://hardhat.org/docs/getting-started), [Node test runner plugin](https://hardhat.org/docs/plugins/hardhat-node-test-runner), [OpenZeppelin ReentrancyGuard](https://docs.openzeppelin.com/contracts/5.x/api/utils#ReentrancyGuard).

## Dependency audit at implementation

The production-only audit (`npm.cmd audit --omit=dev`) reports **0 vulnerabilities**. The full audit reports **5 high-severity entries**, all originating from Hardhat's development dependency on Zod 3 and propagating to the related plugins. See [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), whose patched version is Zod 4.6.6.

The installed current Hardhat 3 toolchain still requires the Zod 3 API. No forced major-version override or downgrade was applied. These development packages are not Solidity bytecode and are not added to the API/bot. Treat tooling inputs as trusted, keep the lockfile under review, and reassess upstream compatibility before a public deployment.

## Local verification result

- Solidity: PASS, two project source files compiled with solc 0.8.38, Paris target.
- TypeScript: PASS.
- Hardhat tests: **39 passed, 0 failed** (29 invoice tests and 10 deployment-guard tests).
- Local deployment smoke test: PASS on ephemeral chain 31337.
- Production-only npm audit: PASS, 0 findings.
- Full npm audit: NOT CLEAN, 5 high-severity development-tooling entries described above.
- The solc dependency uses a targeted tmp 0.2.7 patch override to resolve the compiler package's separate temporary-file advisories without altering compiler bytecode.
- No testnet/mainnet deployment, real key use, commit, or push was performed. API and bot sources were unchanged.
