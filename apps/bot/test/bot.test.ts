import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient } from '../src/api.js';
import { createBot } from '../src/bot.js';
import { loadConfig } from '../src/config.js';

const address = '0x0000000000000000000000000000000000000001';
const network = { name: 'QIE Testnet', chainId: 1983, currency: 'QIE' };
const balance = { address, chainId: 1983, symbol: 'QIE', decimals: 18, balanceWei: '1000000000000000001', balance: '1.000000000000000001' };

function fixture(reply: (url: string, signal: AbortSignal) => Response | Promise<Response> = (url) => Response.json(url.endsWith('/api/network') ? network : balance), timeout = 1000) {
  const calls: string[] = [];
  const replies: string[] = [];
  const api = new ApiClient('http://127.0.0.1:3000', timeout, async (url, init) => {
    assert.equal(init?.method, 'GET');
    assert.equal(init.body, undefined);
    assert.ok(init.signal);
    calls.push(String(url));
    return reply(String(url), init.signal);
  });
  // Dummy fixture only; no live Telegram credentials or Telegram requests.
  const bot = createBot('123:fixture', api);
  bot.botInfo = { id: 123, is_bot: true, first_name: 'QIE AgentPay', username: 'QIEAgentPayBot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
  bot.context.reply = async (text) => {
    replies.push(String(text));
    return { message_id: 1, date: 0, chat: { id: 1, type: 'private', first_name: 'Test' }, text: String(text) };
  };
  let id = 0;
  const send = async (text: string) => {
    const command = text.split(/\s+/)[0] ?? '';
    await bot.handleUpdate({ update_id: ++id, message: {
      message_id: id, date: 0, chat: { id: 1, type: 'private', first_name: 'Test' },
      from: { id: 1, is_bot: false, first_name: 'Test' }, text,
      entities: command.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: command.length }] : [],
    } });
    return replies.at(-1) ?? '';
  };
  return { api, send, calls, replies };
}

test('start, help and invoice work without backend calls', async () => {
  const { send, calls } = fixture();
  assert.match(await send('/start'), /non-custodial/);
  const help = await send('/help');
  for (const command of ['/start', '/help', '/network', '/balance', '/invoice']) assert.ok(help.includes(command));
  assert.match(await send('/invoice'), /coming soon/);
  assert.equal(calls.length, 0);
});

test('network command consumes the existing API contract', async () => {
  const { send, calls } = fixture();
  assert.equal(await send('/network'), 'QIE Testnet\nChain ID: 1983\nNative currency: QIE');
  assert.deepEqual(calls, ['http://127.0.0.1:3000/api/network']);
});

test('balance preserves precision and accepts bot mentions', async () => {
  const { send, calls } = fixture();
  const text = await send(`/balance@QIEAgentPayBot ${address}`);
  assert.match(text, /1\.000000000000000001 QIE/);
  assert.ok(text.includes(address));
  assert.deepEqual(calls, [`http://127.0.0.1:3000/api/wallet/${address}/balance`]);
});

test('address is normalized and zero balance is valid', async () => {
  const checksum = '0x52908400098527886E0F7030069857D2E4169EE7';
  const { send, calls } = fixture(() => Response.json({ ...balance, address: checksum, balanceWei: '0', balance: '0.0' }));
  assert.match(await send(`/balance ${checksum.toLowerCase()}`), /0\.0 QIE/);
  assert.ok(calls[0]?.includes(checksum));
});

test('missing, extra, invalid, checksum-invalid and secret-shaped inputs never reach backend', async () => {
  const { send, calls } = fixture();
  for (const input of ['/balance', `/balance ${address} extra`, '/balance alice.eth', '/balance invalid', `/balance 0x${'1'.repeat(64)}`, '/balance 0x52908400098527886E0F7030069857D2E4169Ee7', '/balance dummy seed phrase words']) {
    const text = await send(input);
    assert.match(text, /Usage:|Invalid wallet address/);
    assert.ok(!text.includes('dummy seed phrase words'));
  }
  assert.equal(calls.length, 0);
});

test('unknown text has safe guidance; commands for another bot are ignored', async () => {
  const { send, calls, replies } = fixture();
  assert.match(await send('dummy secret words'), /\/help/);
  assert.match(await send('/unknown'), /\/help/);
  const count = replies.length;
  await send('/network@AnotherBot');
  assert.equal(replies.length, count);
  assert.equal(calls.length, 0);
});

test('API errors are mapped to safe messages without echoing diagnostics', async () => {
  for (const [status, code, expected] of [
    [504, 'RPC_TIMEOUT', /too long/],
    [502, 'RPC_CHAIN_MISMATCH', /wrong network/],
    [502, 'RPC_UNAVAILABLE', /unavailable/],
    [400, 'INVALID_ADDRESS', /invalid/],
    [500, 'INTERNAL_ERROR', /unavailable/],
  ] as const) {
    const { send } = fixture(() => Response.json({ error: { code, message: 'sensitive upstream detail' } }, { status }));
    const text = await send('/network');
    assert.match(text, expected);
    assert.ok(!text.includes('sensitive upstream detail'));
  }
});

test('connection failures and non-JSON HTTP errors are friendly', async () => {
  for (const reply of [() => { throw new Error('secret diagnostic'); }, () => new Response('secret diagnostic', { status: 503 })]) {
    const { send } = fixture(reply);
    assert.match(await send('/network'), /unavailable/);
  }
});

test('malformed successes and wrong network responses are rejected', async () => {
  for (const body of [{}, { ...network, chainId: 1 }, { ...network, currency: 'ETH' }]) {
    const { send } = fixture(() => Response.json(body));
    assert.match(await send('/network'), /unexpected response/);
  }
  const { send } = fixture(() => new Response('not json'));
  assert.match(await send('/network'), /unexpected response/);
});

test('mismatched addresses and inconsistent balances are rejected', async () => {
  for (const body of [
    { ...balance, address: '0x0000000000000000000000000000000000000002' },
    { ...balance, balanceWei: '1' }, { ...balance, decimals: 6 },
    { ...balance, balance: 1 }, { ...balance, chainId: 1 },
    { ...balance, balanceWei: '-1' },
  ]) {
    const { send } = fixture(() => Response.json(body));
    assert.match(await send(`/balance ${address}`), /unexpected response|unavailable/);
  }
});

test('HTTP timeout aborts stalled request and gives a friendly reply', async () => {
  let aborted = false;
  const { send } = fixture((_url, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
  }), 20);
  assert.match(await send('/network'), /too long/);
  assert.equal(aborted, true);
});

test('HTTP deadline includes response body reading', async () => {
  const { send } = fixture(() => new Response(new ReadableStream({ start() {} })), 20);
  assert.match(await send('/network'), /too long/);
});

test('configuration validates fields without exposing their values', () => {
  const config = loadConfig({ TELEGRAM_BOT_TOKEN: '123:fixture' });
  assert.equal(config.API_BASE_URL, 'http://127.0.0.1:3000');
  assert.equal(config.API_TIMEOUT_MS, 7000);
  for (const env of [{}, { TELEGRAM_BOT_TOKEN: 'secret-invalid-value' }, { TELEGRAM_BOT_TOKEN: '123:fixture', API_BASE_URL: 'file:///tmp/x' }, { TELEGRAM_BOT_TOKEN: '123:fixture', API_BASE_URL: 'https://user:secret@example.com' }, { TELEGRAM_BOT_TOKEN: '123:fixture', API_TIMEOUT_MS: '0' }]) {
    assert.throws(() => loadConfig(env), (error: unknown) => error instanceof Error && error.message.includes('Invalid bot configuration') && !error.message.includes('secret-invalid-value'));
  }
});
