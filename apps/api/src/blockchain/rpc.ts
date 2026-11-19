import { z } from 'zod';
import { ApiError } from '../errors.js';

// Deliberately closed allowlist: this transport cannot submit or sign transactions.
type ReadMethod = 'eth_chainId' | 'eth_getBalance';
const envelopeSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number().int(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
export const quantitySchema = z.string().max(66).regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/);

export class ReadRpcClient {
  private nextId = 0;

  constructor(private readonly url: string, private readonly fetcher: typeof fetch = fetch) {}

  async request(method: ReadMethod, params: readonly string[], signal: AbortSignal): Promise<unknown> {
    if (method !== 'eth_chainId' && method !== 'eth_getBalance') {
      throw new ApiError(500, 'RPC_METHOD_FORBIDDEN', 'RPC method is not permitted.');
    }
    const id = ++this.nextId;
    const response = await this.fetcher(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal,
      redirect: 'error',
    });
    if (!response.ok) throw new ApiError(502, 'RPC_UNAVAILABLE', 'QIE RPC returned an unsuccessful HTTP response.');
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(502, 'RPC_INVALID_RESPONSE', 'QIE RPC returned invalid JSON.');
    }
    const parsed = envelopeSchema.safeParse(body);
    if (!parsed.success || parsed.data.id !== id) {
      throw new ApiError(502, 'RPC_INVALID_RESPONSE', 'QIE RPC returned an invalid response envelope.');
    }
    if (parsed.data.error !== undefined) {
      throw new ApiError(502, 'RPC_ERROR', 'QIE RPC could not complete the read request.');
    }
    return parsed.data.result;
  }
}
