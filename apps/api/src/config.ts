import { z } from 'zod';

export const QIE_CHAIN_ID = 1983;
export const QIE_RPC_URL = 'https://rpc1testnet.qie.digital/';

const environmentSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  QIE_RPC_URL: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  }, 'Must be an HTTP(S) URL without credentials').default(QIE_RPC_URL),
  RPC_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.safeParse(env);
  if (!parsed.success) {
    // Report field names only; never echo environment values.
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  return parsed.data;
}
