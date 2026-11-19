import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { network } from 'hardhat';
import { Contract, type ContractRunner, type TransactionReceipt, type TransactionResponse, ZeroAddress, ZeroHash, id } from 'ethers';

describe('QIEInvoicePayments', () => {
  let connection: Awaited<ReturnType<typeof network.create>>;
  let payments: Contract;
  let merchant: ContractRunner;
  let payer: ContractRunner;
  let stranger: ContractRunner;
  let merchantAddress: string;
  let payerAddress: string;
  let strangerAddress: string;
  let expiry: bigint;
  const invoiceId = id('invoice-one');
  const secondId = id('invoice-two');
  const amount = 1000000000000000001n;

  async function send(contract: Contract, signer: ContractRunner, method: string, ...args: unknown[]): Promise<TransactionReceipt> {
    const tx = await contract.connect(signer).getFunction(method)(...args) as TransactionResponse;
    const receipt = await tx.wait();
    assert.ok(receipt);
    return receipt;
  }
  async function rejects(action: () => Promise<unknown>, name: string) {
    await assert.rejects(action, (error: unknown) => {
      const data = (error as { data?: unknown }).data;
      if (typeof data === 'string') return payments.interface.parseError(data)?.name === name;
      return error instanceof Error && error.message.includes(name);
    }, name);
  }
  async function create() { return send(payments, merchant, 'createInvoice', invoiceId, merchantAddress, amount, expiry); }
  async function pay(value = amount) { return send(payments, payer, 'payInvoice', invoiceId, { value }); }
  async function balanceOf(address: string) {
    return BigInt(await connection.provider.request({ method: 'eth_getBalance', params: [address, 'latest'] }) as string);
  }
  async function advance(timestamp: bigint) {
    await connection.provider.request({ method: 'evm_setNextBlockTimestamp', params: [Number(timestamp)] });
    await connection.provider.request({ method: 'evm_mine', params: [] });
  }
  async function harness() {
    const deployed = await connection.ethers.deployContract('MerchantHarness', [await payments.getAddress()]);
    await deployed.waitForDeployment();
    const receiver = new Contract(await deployed.getAddress(), deployed.interface, merchant);
    await send(receiver, merchant, 'create', invoiceId, amount, expiry);
    return receiver;
  }

  before(async () => { connection = await network.create('hardhatMainnet'); });
  after(async () => { await connection.close(); });
  beforeEach(async () => {
    const signers = await connection.ethers.getSigners();
    [merchant, payer, stranger] = signers;
    [merchantAddress, payerAddress, strangerAddress] = await Promise.all(signers.slice(0, 3).map((s) => s.getAddress()));
    const deployed = await connection.ethers.deployContract('QIEInvoicePayments');
    await deployed.waitForDeployment();
    payments = new Contract(await deployed.getAddress(), deployed.interface, merchant);
    const block = await connection.ethers.provider.getBlock('latest');
    assert.ok(block);
    expiry = BigInt(block.timestamp) + 3600n;
  });

  it('creates a merchant-bound invoice with all initial fields', async () => {
    await create();
    const invoice = await payments.getInvoice(invoiceId);
    assert.equal(invoice.invoiceId, invoiceId);
    assert.equal(invoice.merchant, merchantAddress);
    assert.equal(invoice.amountWei, amount);
    assert.equal(invoice.expiresAt, expiry);
    assert.equal(invoice.payer, ZeroAddress);
    assert.equal(invoice.paidAt, 0n);
    assert.equal(invoice.status, 1n);
    assert.equal(await payments.getInvoiceStatus(invoiceId), 1n);
  });
  it('emits creation event with indexed ID/merchant and exact fields', async () => {
    const receipt = await create();
    assert.equal(receipt.logs.length, 1);
    assert.equal(receipt.logs[0].topics.length, 3);
    const event = payments.interface.parseLog(receipt.logs[0]);
    const block = await connection.ethers.provider.getBlock(receipt.blockNumber);
    assert.ok(event && block);
    assert.equal(event.name, 'InvoiceCreated');
    assert.deepEqual(Array.from(event.args), [invoiceId, merchantAddress, amount, expiry, BigInt(block.timestamp)]);
  });
  it('rejects impersonation of another merchant', async () => {
    await rejects(() => send(payments, stranger, 'createInvoice', invoiceId, merchantAddress, amount, expiry), 'UnauthorizedMerchant');
    assert.equal(await payments.getInvoiceStatus(invoiceId), 0n);
  });
  it('rejects a zero merchant', async () => {
    await rejects(() => send(payments, merchant, 'createInvoice', invoiceId, ZeroAddress, amount, expiry), 'InvalidMerchant');
  });
  it('rejects zero invoice IDs', async () => {
    await rejects(() => send(payments, merchant, 'createInvoice', ZeroHash, merchantAddress, amount, expiry), 'InvalidInvoiceId');
  });
  it('rejects zero amounts', async () => {
    await rejects(() => send(payments, merchant, 'createInvoice', invoiceId, merchantAddress, 0n, expiry), 'InvalidAmount');
  });
  it('rejects zero and past expiration timestamps', async () => {
    for (const expiration of [0n, expiry - 3601n]) {
      await rejects(() => send(payments, merchant, 'createInvoice', invoiceId, merchantAddress, amount, expiration), 'InvalidExpiration');
    }
  });
  it('rejects expiration equal to the execution block timestamp', async () => {
    const block = await connection.ethers.provider.getBlock('latest');
    assert.ok(block);
    await rejects(() => payments.createInvoice.staticCall(invoiceId, merchantAddress, amount, block.timestamp), 'InvalidExpiration');
  });
  it('rejects duplicate IDs from the same and another merchant', async () => {
    await create();
    await rejects(create, 'InvoiceAlreadyExists');
    await rejects(() => send(payments, stranger, 'createInvoice', invoiceId, strangerAddress, amount, expiry), 'InvoiceAlreadyExists');
  });
  it('returns None for unknown status and rejects unknown details/payment', async () => {
    assert.equal(await payments.getInvoiceStatus(invoiceId), 0n);
    await rejects(() => payments.getInvoice(invoiceId), 'InvoiceNotFound');
    await rejects(() => pay(), 'InvoiceNotFound');
  });
  for (const [label, value] of [['zero', 0n], ['underpayment', amount - 1n], ['overpayment', amount + 1n]] as const) {
    it('rejects ' + label + ' without changing invoice state', async () => {
      await create();
      await rejects(() => pay(value), 'IncorrectPayment');
      assert.equal((await payments.getInvoice(invoiceId)).payer, ZeroAddress);
      assert.equal(await payments.getInvoiceStatus(invoiceId), 1n);
      assert.equal(await balanceOf(await payments.getAddress()), 0n);
    });
  }
  it('settles directly, records payer/time, and charges payer only amount plus gas', async () => {
    await create();
    const merchantBefore = await balanceOf(merchantAddress);
    const payerBefore = await balanceOf(payerAddress);
    const receipt = await pay();
    const block = await connection.ethers.provider.getBlock(receipt.blockNumber);
    assert.ok(block);
    const invoice = await payments.getInvoice(invoiceId);
    assert.equal(invoice.status, 2n);
    assert.equal(invoice.payer, payerAddress);
    assert.equal(invoice.paidAt, BigInt(block.timestamp));
    assert.equal(await balanceOf(merchantAddress) - merchantBefore, amount);
    assert.equal(payerBefore - await balanceOf(payerAddress), amount + receipt.fee);
    assert.equal(await balanceOf(await payments.getAddress()), 0n);
  });
  it('emits payment event with three indexed fields and exact amount/time', async () => {
    await create();
    const receipt = await pay();
    assert.equal(receipt.logs.length, 1);
    assert.equal(receipt.logs[0].topics.length, 4);
    const event = payments.interface.parseLog(receipt.logs[0]);
    const block = await connection.ethers.provider.getBlock(receipt.blockNumber);
    assert.ok(event && block);
    assert.equal(event.name, 'InvoicePaid');
    assert.deepEqual(Array.from(event.args), [invoiceId, merchantAddress, payerAddress, amount, BigInt(block.timestamp)]);
  });
  it('allows any other wallet to pay', async () => {
    await create();
    await send(payments, stranger, 'payInvoice', invoiceId, { value: amount });
    assert.equal((await payments.getInvoice(invoiceId)).payer, strangerAddress);
  });
  it('allows merchant self-payment', async () => {
    await create();
    await send(payments, merchant, 'payInvoice', invoiceId, { value: amount });
    assert.equal((await payments.getInvoice(invoiceId)).payer, merchantAddress);
  });
  it('rejects duplicate payments and does not replace payer/time', async () => {
    await create(); await pay();
    const before = await payments.getInvoice(invoiceId);
    await rejects(() => pay(), 'InvoiceAlreadyPaid');
    assert.deepEqual(Array.from(await payments.getInvoice(invoiceId)), Array.from(before));
  });
  for (const offset of [0n, 1n]) {
    it('rejects payment at expiry plus ' + offset + ' seconds', async () => {
      await create(); await advance(expiry + offset);
      assert.equal(await payments.getInvoiceStatus(invoiceId), 3n);
      assert.equal((await payments.getInvoice(invoiceId)).status, 3n);
      await rejects(() => pay(), 'InvoiceExpired');
    });
  }
  it('accepts payment one second before expiry', async () => {
    await create();
    await connection.provider.request({ method: 'evm_setNextBlockTimestamp', params: [Number(expiry - 1n)] });
    await pay();
    assert.equal((await payments.getInvoice(invoiceId)).paidAt, expiry - 1n);
  });
  it('paid status stays paid after expiration and IDs are never reusable', async () => {
    await create(); await pay(); await advance(expiry);
    assert.equal(await payments.getInvoiceStatus(invoiceId), 2n);
    await rejects(() => send(payments, merchant, 'createInvoice', invoiceId, merchantAddress, amount, expiry + 3600n), 'InvoiceAlreadyExists');
  });
  it('expired IDs cannot be reused', async () => {
    await create(); await advance(expiry);
    await rejects(() => send(payments, merchant, 'createInvoice', invoiceId, merchantAddress, amount, expiry + 3600n), 'InvoiceAlreadyExists');
  });
  it('contract merchant sees paid state before receiving payment', async () => {
    const receiver = await harness();
    await send(receiver, merchant, 'configure', invoiceId, invoiceId, false, false, false);
    await pay();
    assert.equal(await receiver.sawPaid(), true);
    assert.equal(await receiver.observedPayer(), payerAddress);
    assert.equal(await receiver.observedPaidAt(), (await payments.getInvoice(invoiceId)).paidAt);
    assert.equal(await balanceOf(await receiver.getAddress()), amount);
  });
  it('settlement failure rolls back funds, state and logs; later retry succeeds', async () => {
    const receiver = await harness();
    await send(receiver, merchant, 'configure', invoiceId, invoiceId, true, false, false);
    await rejects(() => send(payments, payer, 'payInvoice', invoiceId, { value: amount, gasLimit: 500000n }), 'SettlementFailed');
    const invoice = await payments.getInvoice(invoiceId);
    assert.equal(invoice.status, 1n);
    assert.equal(invoice.payer, ZeroAddress);
    assert.equal(invoice.paidAt, 0n);
    assert.equal(await balanceOf(await receiver.getAddress()), 0n);
    assert.equal(await balanceOf(await payments.getAddress()), 0n);
    assert.equal((await payments.queryFilter(payments.filters.InvoicePaid(invoiceId))).length, 0);
    await send(receiver, merchant, 'configure', invoiceId, invoiceId, false, false, false);
    await pay();
    assert.equal(await payments.getInvoiceStatus(invoiceId), 2n);
  });
  for (const crossInvoice of [false, true]) {
    it('blocks ' + (crossInvoice ? 'cross-invoice' : 'same-invoice') + ' reentry while permitting settlement if caught', async () => {
      const receiver = await harness();
      if (crossInvoice) await send(receiver, merchant, 'create', secondId, amount, expiry);
      await send(receiver, merchant, 'configure', invoiceId, crossInvoice ? secondId : invoiceId, false, true, false);
      await pay();
      assert.equal(await receiver.reentrySucceeded(), false);
      assert.equal(await receiver.reentryError(), id('ReentrancyGuardReentrantCall()').slice(0, 10));
      assert.equal(await payments.getInvoiceStatus(invoiceId), 2n);
      if (crossInvoice) assert.equal(await payments.getInvoiceStatus(secondId), 1n);
      assert.equal(await balanceOf(await receiver.getAddress()), amount);
      assert.equal(await balanceOf(await payments.getAddress()), 0n);
      assert.equal((await payments.queryFilter(payments.filters.InvoicePaid(invoiceId))).length, 1);
    });
  }
  it('reverts atomically if merchant propagates rejected reentry', async () => {
    const receiver = await harness();
    await send(receiver, merchant, 'configure', invoiceId, invoiceId, false, true, true);
    await rejects(() => send(payments, payer, 'payInvoice', invoiceId, { value: amount, gasLimit: 500000n }), 'SettlementFailed');
    assert.equal(await payments.getInvoiceStatus(invoiceId), 1n);
    assert.equal((await payments.getInvoice(invoiceId)).payer, ZeroAddress);
    assert.equal(await balanceOf(await receiver.getAddress()), 0n);
    assert.equal((await payments.queryFilter(payments.filters.InvoicePaid(invoiceId))).length, 0);
  });
  it('rejects unsolicited native transfers and value on invoice creation', async () => {
    const signer = (await connection.ethers.getSigners())[1];
    await assert.rejects(() => signer.sendTransaction({ to: payments.target, value: amount }));
    await assert.rejects(() => send(payments, merchant, 'createInvoice', invoiceId, merchantAddress, amount, expiry, { value: 1n }));
    assert.equal(await balanceOf(await payments.getAddress()), 0n);
  });
});
