export interface ChainReader { send(method: string, params: unknown[]): Promise<unknown> }

export async function verifyQieChain(provider: ChainReader): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = await Promise.race([
      provider.send('eth_chainId', []),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('RPC chain check timed out.')), 10000); }),
    ]);
    if (typeof id !== 'string' || !/^0x[0-9a-fA-F]+$/.test(id) || BigInt(id) !== 1983n) {
      throw new Error('Deployment refused: expected QIE Testnet chain ID 1983.');
    }
  } finally { clearTimeout(timer); }
}

// Neither deployment nor key access takes place before verification.
export async function withVerifiedQie<T>(provider: ChainReader, deploy: () => Promise<T>): Promise<T> {
  await verifyQieChain(provider);
  return deploy();
}
