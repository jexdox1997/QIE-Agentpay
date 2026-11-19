import 'dotenv/config';
import { createApp } from './app.js';
import { ReadRpcClient } from './blockchain/rpc.js';
import { BlockchainService } from './blockchain/service.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const blockchain = new BlockchainService(new ReadRpcClient(config.QIE_RPC_URL), config.RPC_TIMEOUT_MS);
const server = createApp(blockchain).listen(config.PORT, config.HOST, () => {
  console.log(`QIE AgentPay API listening on http://${config.HOST}:${config.PORT}`);
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.on('error', () => {
  console.error('API failed to listen. Check HOST, PORT, and whether the port is available.');
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    const deadline = setTimeout(() => server.closeAllConnections(), config.RPC_TIMEOUT_MS + 1000);
    deadline.unref();
  });
}
