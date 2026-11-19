import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { artifacts } from 'hardhat';
import { ContractFactory, FetchRequest, JsonRpcProvider, Wallet } from 'ethers';
import { verifyQieChain, withVerifiedQie } from './testnet-guard.ts';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

async function main() {
  if (process.env.CONFIRM_QIE_TESTNET_DEPLOYMENT !== 'true') throw new Error('Deployment disabled.');
  const url = new URL(process.env.QIE_TESTNET_RPC_URL ?? 'https://rpc1testnet.qie.digital/');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid RPC URL.');
  const request = new FetchRequest(url.href);
  request.timeout = 10000;
  const provider = new JsonRpcProvider(request, 1983, { batchMaxCount: 1, cacheTimeout: -1 });
  try {
    await withVerifiedQie(provider, async () => {
      const key = process.env.QIE_TESTNET_PRIVATE_KEY;
      if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Missing or invalid deployment key.');
      const signer = new Wallet(key, provider);
      const artifact = await artifacts.readArtifact('QIEInvoicePayments');
      const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
      await verifyQieChain(provider);
      const contract = await factory.deploy({ chainId: 1983 });
      const transaction = contract.deploymentTransaction();
      if (!transaction) throw new Error('Missing deployment transaction.');
      console.log(`QIE Testnet deployment submitted: ${transaction.hash}`);
      const receipt = await transaction.wait(1, 120000);
      if (!receipt || receipt.status !== 1) throw new Error('Deployment not confirmed.');
      console.log(`QIEInvoicePayments: ${await contract.getAddress()} (chain 1983)`);
    });
  } finally { provider.destroy(); }
}

void main().catch(() => {
  // Never print provider errors, signed transactions, keys, or configuration values.
  console.error('Testnet deployment stopped. Check opt-in, RPC chain 1983, local key configuration and testnet funds. If a hash was printed, inspect it before retrying.');
  process.exitCode = 1;
});
