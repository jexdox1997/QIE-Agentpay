import assert from 'node:assert/strict';
import { it } from 'node:test';
import { withVerifiedQie } from '../scripts/testnet-guard.ts';

it('testnet guard checks chain 1983 before enabling key access/deployment', async () => {
  const steps: string[] = [];
  await withVerifiedQie({ send: async (method, params) => {
    assert.equal(method, 'eth_chainId'); assert.deepEqual(params, []);
    steps.push('verify'); return '0x7bf';
  } }, async () => { steps.push('deploy'); });
  assert.deepEqual(steps, ['verify', 'deploy']);
});
for (const chain of ['0x1', '0x7be', '0x7c0', '1983', 1983, null, '0xZZ']) {
  it('testnet guard refuses invalid/wrong chain ' + String(chain), async () => {
    let called = false;
    await assert.rejects(() => withVerifiedQie({ send: async () => chain }, async () => { called = true; }), /1983/);
    assert.equal(called, false);
  });
}
it('testnet RPC failure cannot reach key/deployment callback', async () => {
  let called = false;
  await assert.rejects(() => withVerifiedQie({ send: async () => { throw new Error('offline'); } }, async () => { called = true; }), /offline/);
  assert.equal(called, false);
});

it('testnet guard times out without entering the deployment callback', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let called = false;
  const result = assert.rejects(() => withVerifiedQie(
    { send: async () => new Promise(() => {}) },
    async () => { called = true; },
  ), /timed out/);
  context.mock.timers.tick(10000);
  await result;
  assert.equal(called, false);
});
