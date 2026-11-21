import { isIP } from 'net';
import { ASSET_CRITICALITIES, ASSET_TYPES, type AssetCriticality, type AssetType } from '../db/schema';
import { badRequest, optStr } from '../lib/http';

/* Validation shared by the assets API and the assets CSV import. */

const MAX_IPS = 10;

/* One or more IPv4/IPv6 addresses, comma, semicolon, | or space separated. */
export function parseIps(v: unknown): string | null {
  const raw = optStr(v, 500);
  if (!raw) return null;
  const ips = Array.from(new Set(raw.split(/[\s,;|]+/).filter(Boolean)));
  if (ips.length > MAX_IPS) throw badRequest(`At most ${MAX_IPS} IP addresses per asset`);
  const bad = ips.find((ip) => isIP(ip) === 0);
  if (bad) throw badRequest(`Invalid IP address: ${bad.slice(0, 50)}`);
  return ips.join(', ');
}

const HOSTNAME_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,252}[A-Za-z0-9_])?$/;

export function parseHostname(v: unknown): string | null {
  const h = optStr(v, 300);
  if (!h) return null;
  if (h.length > 253 || !HOSTNAME_RE.test(h) || h.includes('..')) throw badRequest('Invalid hostname');
  return h;
}

function norm(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_-]+/g, ' ');
}

/* English or Spanish names for asset types, as people write them in a sheet. */
const TYPE_ALIASES: Record<string, AssetType> = {
  servidor: 'server', 'estacion de trabajo': 'workstation', 'puesto de trabajo': 'workstation', pc: 'workstation', desktop: 'workstation',
  portatil: 'laptop', notebook: 'laptop', red: 'network', 'equipo de red': 'network', 'network device': 'network', switch: 'network', router: 'network',
  'base de datos': 'database', db: 'database', aplicacion: 'application', app: 'application', nube: 'cloud', movil: 'mobile', otro: 'other',
};

export function parseAssetType(v: string): AssetType | null {
  const n = norm(v);
  if (!n) return 'other';
  if ((ASSET_TYPES as readonly string[]).includes(n)) return n as AssetType;
  return TYPE_ALIASES[n] ?? null;
}

const CRIT_ALIASES: Record<string, AssetCriticality> = {
  alta: 'high', alto: 'high', critica: 'high', critico: 'high', critical: 'high', h: 'high', '3': 'high',
  media: 'medium', medio: 'medium', med: 'medium', m: 'medium', '2': 'medium',
  baja: 'low', bajo: 'low', l: 'low', '1': 'low',
};

export function parseCriticality(v: string): AssetCriticality | null {
  const n = norm(v);
  if (!n) return 'medium';
  if ((ASSET_CRITICALITIES as readonly string[]).includes(n)) return n as AssetCriticality;
  return CRIT_ALIASES[n] ?? null;
}
