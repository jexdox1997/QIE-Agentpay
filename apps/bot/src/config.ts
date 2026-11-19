import { z } from 'zod';

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/),
  API_BASE_URL: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === '/';
  }).default('http://127.0.0.1:3000'),
  API_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(7000),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Never include environment values or Zod's original error object.
    throw new Error(`Invalid bot configuration: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`);
  }
  return parsed.data;
}
