import { badRequest } from '../../lib/http';

/* Where a Telegram channel delivers: a bot token (from @BotFather) and the
   chat it posts to. Stored as JSON, encrypted at rest in channels.webhook_url.
   The token never leaves the server. */

export interface TelegramTarget {
  botToken: string;
  /* Numeric chat id (groups/channels are negative) or @channelusername. */
  chatId: string;
}

const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

export function parseTelegramTarget(body: unknown, previous?: TelegramTarget | null): TelegramTarget {
  const b = (body ?? {}) as { botToken?: unknown; chatId?: unknown };
  const rawToken = typeof b.botToken === 'string' ? b.botToken.trim() : '';
  const botToken = rawToken || previous?.botToken || '';
  if (!botToken) throw badRequest('Telegram bot token is required');
  if (!TOKEN_RE.test(botToken)) throw badRequest('That does not look like a Telegram bot token (123456789:AA…)');
  const chatId = typeof b.chatId === 'string' || typeof b.chatId === 'number' ? String(b.chatId).trim() : previous?.chatId ?? '';
  if (!CHAT_RE.test(chatId)) throw badRequest('Telegram chat ID must be a number (e.g. -1001234567890) or @channelname');
  return { botToken, chatId };
}

export function serializeTelegramTarget(t: TelegramTarget): string {
  return JSON.stringify({ botToken: t.botToken, chatId: t.chatId });
}

export function parseStoredTelegramTarget(raw: string): TelegramTarget {
  const v = JSON.parse(raw) as TelegramTarget;
  if (!TOKEN_RE.test(v.botToken) || !CHAT_RE.test(v.chatId)) throw new Error('Invalid stored Telegram target');
  return v;
}

/* Only the chat and the bot id (the part before ":") are ever shown. */
export function publicTelegramTarget(t: TelegramTarget): { chatId: string; botId: string; tokenSet: true } {
  return { chatId: t.chatId, botId: t.botToken.split(':')[0], tokenSet: true };
}

export function telegramApiUrl(t: TelegramTarget, method: string): URL {
  return new URL(`https://api.telegram.org/bot${t.botToken}/${method}`);
}
