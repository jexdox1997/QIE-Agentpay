import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { ApiClient, UserError } from './api.js';

const help = [
  'QIE AgentPay commands:',
  '/start - Welcome and introduction',
  '/help - Show available commands',
  '/network - Show QIE Testnet information',
  '/balance <walletAddress> - Check a public wallet balance',
  '/invoice - Invoice feature status (coming soon)',
  '',
  'Never send private keys or seed phrases. This bot cannot sign transactions or move funds.',
].join('\n');

export function createBot(token: string, api: ApiClient) {
  const bot = new Telegraf(token, { handlerTimeout: 40000 });
  // Only predefined safe messages reach Telegram; no raw API errors or input echoes.
  const read = async (operation: () => Promise<string>) => {
    try { return await operation(); }
    catch (error) { return error instanceof UserError ? error.message : 'Something went wrong. Please try again later.'; }
  };
  bot.start((ctx) => ctx.reply('Welcome to QIE AgentPay! Your non-custodial QIE payment assistant.\n\nPhase 2 lets you check QIE Testnet information and public wallet balances. Payments and invoices are not available yet.\n\nNever send private keys or seed phrases. We cannot sign transactions or move funds.\n\nUse /help to see all commands.'));
  bot.help((ctx) => ctx.reply(help));
  bot.command('network', async (ctx) => ctx.reply(await read(async () => {
    const network = await api.network();
    return `${network.name}\nChain ID: ${network.chainId}\nNative currency: ${network.currency}`;
  })));
  bot.command('balance', async (ctx) => {
    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    if (args.length !== 1 || !args[0]) {
      return ctx.reply('Usage: /balance <walletAddress>\nProvide exactly one public EVM address. Never send private keys or seed phrases.');
    }
    const address = args[0];
    return ctx.reply(await read(async () => {
      const result = await api.balance(address);
      return `QIE Testnet balance\nAddress: ${result.address}\nBalance: ${result.balance} ${result.symbol}\nChain ID: ${result.chainId}`;
    }));
  });
  bot.command('invoice', (ctx) => ctx.reply('Invoices are coming soon. No invoice has been created. For now, use /network or /balance <walletAddress>.'));
  bot.on(message('text'), (ctx) => {
    // Ignore commands explicitly addressed to another bot in a group.
    if (/^\/\w+@\w+/.test(ctx.message.text)) return;
    return ctx.reply('Use /help to see supported commands. Only public wallet addresses are needed; never send private keys or seed phrases.');
  });
  bot.catch(() => {
    // Telegram errors may contain credential-bearing URLs. Never log the error/update.
    console.error('A Telegram update could not be completed. Check connectivity and bot permissions.');
  });
  return bot;
}
