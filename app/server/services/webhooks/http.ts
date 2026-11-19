import dns from 'dns';
import http from 'http';
import https from 'https';
import { flags } from '../../config';
import { isIpLiteral, isPublicAddress, stripBrackets } from './address';

/* Outbound POST to a company-supplied webhook URL, hardened against SSRF:
   - DNS is resolved here and every returned address must be public; the
     socket then connects to exactly the address that was checked (no DNS
     rebinding window)
   - literal-IP hosts are checked the same way
   - redirects are never followed; there is a timeout and a response cap.
   Rocket.Chat servers on a private LAN can be allowed explicitly with
   CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS=true. */

export class WebhookError extends Error {}

const MAX_RESPONSE_BYTES = 16 * 1024;

function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as dns.LookupAddress[];
    const blocked = list.find((a) => !isPublicAddress(a.address));
    if (blocked && !flags.allowPrivateWebhooks()) {
      return callback(Object.assign(new Error(`Refusing to connect to non-public address ${blocked.address}`), { code: 'EBLOCKED' }), '', 0);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export function postJson(url: URL, payload: unknown, timeoutMs = 15_000): Promise<{ status: number; body: string }> {
  const host = stripBrackets(url.hostname);
  if (isIpLiteral(host) && !isPublicAddress(host) && !flags.allowPrivateWebhooks()) {
    return Promise.reject(new WebhookError(`Refusing to connect to non-public address ${host}`));
  }
  const body = JSON.stringify(payload);
  const mod = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'HackerDo-CyberPulse/1.0',
      },
      lookup: guardedLookup as unknown as typeof dns.lookup,
      timeout: timeoutMs,
    }, (res) => {
      let received = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new WebhookError('Webhook request timed out')));
    req.on('error', (err: NodeJS.ErrnoException) => {
      reject(err instanceof WebhookError ? err : new WebhookError(err.code === 'EBLOCKED' ? err.message : `Webhook request failed: ${err.code || err.message}`));
    });
    req.end(body);
  });
}
