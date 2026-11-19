import { network } from 'hardhat';

// Explicit simulation: never uses a remote RPC or environment key.
const connection = await network.create('hardhatMainnet');
try {
  if ((await connection.ethers.provider.getNetwork()).chainId !== 31337n) throw new Error('Expected local chain 31337.');
  const contract = await connection.ethers.deployContract('QIEInvoicePayments');
  await contract.waitForDeployment();
  console.log(`Local QIEInvoicePayments: ${await contract.getAddress()} (chain 31337; ephemeral)`);
} finally { await connection.close(); }
