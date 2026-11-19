import { formatEther, getAddress, isAddress } from 'ethers';
import { z } from 'zod';

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(isAddress);
// These contracts mirror apps/api/src/blockchain/service.ts and src/app.ts.
const networkSchema = z.object({ name: z.literal('QIE Testnet'), chainId: z.literal(1983), currency: z.literal('QIE') });
const balanceSchema = z.object({
  address: addressSchema,
  chainId: z.literal(1983),
  symbol: z.literal('QIE'),
  decimals: z.literal(18),
  balanceWei: z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).refine((v) => /^(0|[1-9][0-9]*)$/.test(v) && v.length <= 78 && BigInt(v) < 2n ** 256n),
  balance: z.string().max(80).regex(/^(0|[1-9][0-9]*)\.[0-9]{1,18}$/),
}).refine((v) => {
  if (!/^(0|[1-9][0-9]*)$/.test(v.balanceWei) || v.balanceWei.length > 78) return false;
  return v.balance === formatEther(BigInt(v.balanceWei));
});
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export class UserError extends Error {}
const unavailable = 'The QIE service is unavailable right now. Please try again shortly.';
const timeout = 'The QIE service took too long to respond. Please try again.';
const invalidResponse = 'The QIE service returned an unexpected response. Please try again later.';

export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 7000, private readonly fetcher: typeof fetch = fetch) {}

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new UserError(timeout));
      }, this.timeoutMs);
    });
    const operation = async () => {
      const response = await this.fetcher(new URL(path, this.baseUrl), {
        method: 'GET', signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' },
      });
      let body: unknown;
      try { body = await response.json(); }
      catch { throw new UserError(response.ok ? invalidResponse : unavailable); }
      if (!response.ok) {
        const parsed = errorSchema.safeParse(body);
        const code = parsed.success ? parsed.data.error.code : '';
        if (response.status === 504 || code === 'RPC_TIMEOUT') throw new UserError(timeout);
        if (code === 'RPC_CHAIN_MISMATCH') throw new UserError('The QIE service is connected to the wrong network. Please try again later.');
        if (code === 'INVALID_ADDRESS') throw new UserError('That wallet address is invalid. Use /balance followed by a public EVM address.');
        throw new UserError(unavailable);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new UserError(invalidResponse);
      return parsed.data;
    };
    try { return await Promise.race([operation(), deadline]); }
    catch (error) {
      if (controller.signal.aborted) throw new UserError(timeout);
      if (error instanceof UserError) throw error;
      throw new UserError(unavailable);
    } finally { clearTimeout(timer); }
  }

  network() { return this.get('/api/network', networkSchema); }

  async balance(input: string) {
    if (!addressSchema.safeParse(input).success) throw new UserError('Invalid wallet address. Use a public 0x address with 40 hex characters and a valid checksum if mixed case.');
    const address = getAddress(input);
    const result = await this.get(`/api/wallet/${address}/balance`, balanceSchema);
    if (getAddress(result.address) !== address) throw new UserError(invalidResponse);
    return result;
  }
}
