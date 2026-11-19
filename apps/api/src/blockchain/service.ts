import { formatEther, getAddress, isAddress } from 'ethers';
import { z } from 'zod';
import { QIE_CHAIN_ID } from '../config.js';
import { ApiError } from '../errors.js';
import { quantitySchema, ReadRpcClient } from './rpc.js';

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(isAddress);

export class BlockchainService {
  constructor(private readonly rpc: ReadRpcClient, private readonly timeoutMs: number) {}

  private async bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ApiError(504, 'RPC_TIMEOUT', 'QIE RPC request timed out.'));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([operation(controller.signal), deadline]);
    } catch (error) {
      if (controller.signal.aborted) throw new ApiError(504, 'RPC_TIMEOUT', 'QIE RPC request timed out.');
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'RPC_UNAVAILABLE', 'Unable to reach QIE RPC.');
    } finally {
      clearTimeout(timer);
    }
  }

  private async verifyChain(signal: AbortSignal): Promise<void> {
    const parsed = quantitySchema.safeParse(await this.rpc.request('eth_chainId', [], signal));
    if (!parsed.success) throw new ApiError(502, 'RPC_INVALID_RESPONSE', 'QIE RPC returned an invalid chain ID.');
    if (BigInt(parsed.data) !== BigInt(QIE_CHAIN_ID)) {
      throw new ApiError(502, 'RPC_CHAIN_MISMATCH', 'QIE RPC is not connected to the required chain (1983).');
    }
  }

  async network() {
    return this.bounded(async (signal) => {
      await this.verifyChain(signal);
      return { name: 'QIE Testnet', chainId: QIE_CHAIN_ID, currency: 'QIE' };
    });
  }

  async balance(input: string) {
    if (!addressSchema.safeParse(input).success) {
      throw new ApiError(400, 'INVALID_ADDRESS', 'Provide a valid EVM address (0x followed by 40 hex characters, with a valid checksum if mixed case).');
    }
    const address = getAddress(input);
    return this.bounded(async (signal) => {
      await this.verifyChain(signal);
      const parsed = quantitySchema.safeParse(await this.rpc.request('eth_getBalance', [address, 'latest'], signal));
      if (!parsed.success || BigInt(parsed.data) >= 2n ** 256n) {
        throw new ApiError(502, 'RPC_INVALID_RESPONSE', 'QIE RPC returned an invalid balance.');
      }
      // Recheck before exposing the result; never rely on a cached network detection.
      await this.verifyChain(signal);
      const wei = BigInt(parsed.data);
      return { address, chainId: QIE_CHAIN_ID, symbol: 'QIE', decimals: 18, balanceWei: wei.toString(), balance: formatEther(wei) };
    });
  }
}
