import { createRequire } from 'node:module';
import { defineConfig } from 'hardhat/config';
import ethers from '@nomicfoundation/hardhat-ethers';
import nodeTestRunner from '@nomicfoundation/hardhat-node-test-runner';

const require = createRequire(import.meta.url);
export default defineConfig({
  plugins: [ethers, nodeTestRunner],
  solidity: {
    version: '0.8.38',
    path: require.resolve('solc/soljson.js'),
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' },
  },
  networks: { hardhatMainnet: { type: 'edr-simulated', chainType: 'l1', chainId: 31337 } },
});
