import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ApiClient } from './api.js';
import { createBot } from './bot.js';
import { loadConfig } from './config.js';

// Resolves apps/bot/.env both from src/main.ts and compiled dist/main.js.
dotenv({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

async function main() {
  const config = loadConfig();
  const bot = createBot(config.TELEGRAM_BOT_TOKEN, new ApiClient(config.API_BASE_URL, config.API_TIMEOUT_MS));
  let stopping = false;
  let retry: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('Stopping QIE AgentPay bot.');
    // Also handles a signal during getMe/deleteWebhook before polling is initialized.
    const tryStop = () => {
      try { bot.stop('shutdown'); clearInterval(retry); }
      catch { /* Launch has not initialized polling yet; retry until the deadline. */ }
    };
    retry = setInterval(tryStop, 100);
    deadline = setTimeout(() => process.exit(0), 15000);
    tryStop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    // No webhook configuration: Telegraf uses long polling. Only process new messages.
    await bot.launch({ allowedUpdates: ['message'], dropPendingUpdates: true }, () => {
      if (!stopping) console.log('QIE AgentPay bot starting long polling.');
    });
  } finally {
    clearInterval(retry);
    clearTimeout(deadline);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

void main().catch(() => {
  // Do not print tokens, configuration objects, Telegram errors, or request URLs.
  console.error('Bot startup or polling failed. Check apps/bot/.env, Telegram connectivity, and that only one instance is running.');
  process.exitCode = 1;
});
