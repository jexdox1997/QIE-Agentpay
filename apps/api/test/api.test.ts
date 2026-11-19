import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { BlockchainService } from '../src/blockchain/service.js';
import { ReadRpcClient } from '../src/blockchain/rpc.js';
import { loadConfig } from '../src/config.js';

const address = '0x0000000000000000000000000000000000000001';
type RpcRequest = { id: number; method: string; params: string[] };
type Reply = (rpc: RpcRequest, signal: AbortSignal) => Response | Promise<Response>;
const result = (rpc: RpcRequest, value: unknown) => Response.json({ jsonrpc: '2.0', id: rpc.id, result: value });

function fixture(reply: Reply = (rpc) => result(rpc, rpc.method === 'eth_chainId' ? '0x7bf' : '0xde0b6b3a7640000'), timeout = 1000) {
  const calls: RpcRequest[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const rpc = JSON.parse(String(init?.body)) as RpcRequest;
    calls.push(rpc);
    assert.ok(init?.signal);
    return reply(rpc, init.signal);
  };
  const service = new BlockchainService(new ReadRpcClient('https://mock.invalid/', fetcher), timeout);
  return { app: createApp(service), calls };
}

test('health is liveness and does not depend on RPC', async () => {
  const { app, calls } = fixture();
  const response = await request(app).get('/health').expect(200);
  assert.deepEqual(response.body, { status: 'ok', service: 'qie-agentpay-api' });
  assert.equal(calls.length, 0);
});

test('network verifies QIE chain ID', async () => {
  const { app, calls } = fixture();
  const response = await request(app).get('/api/network').expect(200);
  assert.equal(response.body.chainId, 1983);
  assert.deepEqual(calls.map((call) => call.method), ['eth_chainId']);
});

test('balance preserves precision and checks chain before and after the read', async () => {
  const { app, calls } = fixture();
  const response = await request(app).get(`/api/wallet/${address}/balance`).expect(200);
  assert.deepEqual(response.body, { address, chainId: 1983, symbol: 'QIE', decimals: 18, balanceWei: '1000000000000000000', balance: '1.0' });
  assert.deepEqual(calls.map((call) => call.method), ['eth_chainId', 'eth_getBalance', 'eth_chainId']);
  assert.deepEqual(calls[1]?.params, [address, 'latest']);
});

test('zero balance is valid', async () => {
  const { app } = fixture((rpc) => result(rpc, rpc.method === 'eth_chainId' ? '0x7bf' : '0x0'));
  const response = await request(app).get(`/api/wallet/${address}/balance`).expect(200);
  assert.equal(response.body.balanceWei, '0');
});

test('lowercase addresses are normalized to checksum form', async () => {
  const { app, calls } = fixture();
  const response = await request(app).get('/api/wallet/0x52908400098527886e0f7030069857d2e4169ee7/balance').expect(200);
  assert.equal(response.body.address, '0x52908400098527886E0F7030069857D2E4169EE7');
  assert.equal(calls[1]?.params[0], response.body.address);
});

test('invalid addresses, bad checksums, private-key-shaped strings and ENS names make no RPC calls', async () => {
  const { app, calls } = fixture();
  for (const invalid of ['not-an-address', 'alice.eth', `0x${'1'.repeat(64)}`, '0x52908400098527886E0F7030069857D2E4169Ee7']) {
    const response = await request(app).get(`/api/wallet/${invalid}/balance`).expect(400);
    assert.equal(response.body.error.code, 'INVALID_ADDRESS');
  }
  assert.equal(calls.length, 0);
});

test('wrong chain fails closed before a balance read', async () => {
  const { app, calls } = fixture((rpc) => result(rpc, '0x1'));
  for (const route of ['/api/network', `/api/wallet/${address}/balance`]) {
    const response = await request(app).get(route).expect(502);
    assert.equal(response.body.error.code, 'RPC_CHAIN_MISMATCH');
  }
  assert.ok(calls.every((call) => call.method === 'eth_chainId'));
});

test('chain switch during a balance read rejects the result', async () => {
  let chainReads = 0;
  const { app } = fixture((rpc) => result(rpc, rpc.method === 'eth_chainId' ? (++chainReads === 1 ? '0x7bf' : '0x1') : '0x1'));
  const response = await request(app).get(`/api/wallet/${address}/balance`).expect(502);
  assert.equal(response.body.error.code, 'RPC_CHAIN_MISMATCH');
  assert.equal(response.body.balance, undefined);
});

test('timeouts abort stalled RPC requests', async () => {
  let aborted = false;
  const { app } = fixture((_rpc, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
  }), 20);
  const response = await request(app).get('/api/network').expect(504);
  assert.equal(response.body.error.code, 'RPC_TIMEOUT');
  assert.equal(aborted, true);
});

test('timeout also covers reading the RPC response body', async () => {
  const { app } = fixture(() => new Response(new ReadableStream({ start() { /* Deliberately never ends. */ } })), 20);
  const response = await request(app).get('/api/network').expect(504);
  assert.equal(response.body.error.code, 'RPC_TIMEOUT');
});

test('timeout covers a stalled balance after a successful chain check', async () => {
  const { app } = fixture((rpc) => rpc.method === 'eth_chainId'
    ? result(rpc, '0x7bf') : new Promise<Response>(() => {}), 20);
  const response = await request(app).get(`/api/wallet/${address}/balance`).expect(504);
  assert.equal(response.body.error.code, 'RPC_TIMEOUT');
});

test('upstream failures are sanitized', async () => {
  const cases: Array<[Reply, string]> = [
    [() => { throw new Error('sensitive upstream diagnostic'); }, 'RPC_UNAVAILABLE'],
    [() => new Response('sensitive upstream diagnostic', { status: 503 }), 'RPC_UNAVAILABLE'],
    [(rpc) => Response.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: 'sensitive upstream diagnostic' } }), 'RPC_ERROR'],
    [() => new Response('not json'), 'RPC_INVALID_RESPONSE'],
    [(rpc) => Response.json({ jsonrpc: '2.0', id: rpc.id + 1, result: '0x7bf' }), 'RPC_INVALID_RESPONSE'],
    [(rpc) => result(rpc, '1983'), 'RPC_INVALID_RESPONSE'],
    [(rpc) => Response.json({ jsonrpc: '1.0', id: rpc.id, result: '0x7bf' }), 'RPC_INVALID_RESPONSE'],
  ];
  for (const [reply, code] of cases) {
    const { app } = fixture(reply);
    const response = await request(app).get('/api/network').expect(502);
    assert.equal(response.body.error.code, code);
    assert.ok(!response.text.includes('sensitive upstream diagnostic'));
  }
});

test('malformed, missing, negative and oversized balances are rejected', async () => {
  for (const invalid of [null, undefined, '-1', '0x', '0x00', '0xnope', `0x1${'0'.repeat(64)}`]) {
    const { app } = fixture((rpc) => result(rpc, rpc.method === 'eth_chainId' ? '0x7bf' : invalid));
    const response = await request(app).get(`/api/wallet/${address}/balance`).expect(502);
    assert.equal(response.body.error.code, 'RPC_INVALID_RESPONSE');
  }
});

test('bodies, query parameters and signing routes are never processed', async () => {
  const { app, calls } = fixture();
  await request(app).post('/api/wallet/sign').send({ privateKey: 'dummy-secret' }).expect(405);
  await request(app).get('/api/network?seedPhrase=dummy-secret').expect(400);
  await request(app).get('/api/network').send({ privateKey: 'dummy-secret' }).expect(400);
  await request(app).get('/api/wallet/sign').expect(404);
  await request(app).get('/api/wallet/%ZZ/balance').expect(400);
  assert.equal(calls.length, 0);
});

test('configuration defaults and validation', () => {
  assert.equal(loadConfig({}).QIE_RPC_URL, 'https://rpc1testnet.qie.digital/');
  for (const env of [{ PORT: '0' }, { RPC_TIMEOUT_MS: '0' }, { QIE_RPC_URL: 'file:///tmp/test' }, { QIE_RPC_URL: 'https://user:secret@example.com' }]) {
    assert.throws(() => loadConfig(env), /Invalid configuration/);
  }
});
