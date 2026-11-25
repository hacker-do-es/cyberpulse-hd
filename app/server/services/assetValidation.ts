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
  /* Names other inventories and scanners use. */
  'web application': 'application', webapp: 'application', 'web app': 'application', website: 'application', web: 'application',
  'sitio web': 'application', 'aplicacion web': 'application', api: 'application', 'rest api': 'application', service: 'application', servicio: 'application',
  cdn: 'proxy', 'cloud service': 'cloud', paas: 'cloud', iaas: 'cloud', 'saas app': 'saas', 'saas application': 'saas',
  vm: 'server', 'virtual machine': 'server', 'maquina virtual': 'server', host: 'server', nas: 'server', storage: 'server',
  'load balancer': 'network', lb: 'network', ap: 'network', 'access point': 'network', 'punto de acceso': 'network', vpn: 'vpn', utm: 'firewall',
  'dns record': 'dns', domain: 'dns', dominio: 'dns', printer: 'other', impresora: 'other',
  phone: 'mobile', smartphone: 'mobile', tablet: 'mobile', telefono: 'mobile', camera: 'iot', camara: 'iot', sensor: 'iot',
  /* Functional classes from scanners / ASM exports (map to the typed enum). */
  'identity provider': 'identity', idp: 'identity', sso: 'identity', 'proveedor de identidad': 'identity',
  'monitoring/observability': 'monitoring', monitoring: 'monitoring', observability: 'monitoring', apm: 'monitoring', 'monitorizacion': 'monitoring',
  'ci/cd gitops': 'cicd', 'ci/cd': 'cicd', 'ci cd': 'cicd', gitops: 'cicd', 'iac automation': 'cicd', iac: 'cicd',
  'workflow engine': 'automation', 'workflow automation': 'automation', workflow: 'automation', automation: 'automation', 'automatizacion': 'automation', 'integration endpoint': 'automation', integration: 'automation', webhook: 'automation',
  'siem/xdr': 'siem', siem: 'siem', xdr: 'siem', edr: 'siem', soar: 'siem',
  'vpn/network': 'vpn',
  'domain/dns zone': 'dns', 'dns zone': 'dns', 'zona dns': 'dns',
  'cdn/waf/reverse proxy': 'proxy', 'reverse proxy': 'proxy', 'proxy inverso': 'proxy', waf: 'proxy', 'access proxy': 'proxy', 'identity aware proxy': 'proxy', iap: 'proxy', bastion: 'proxy', gateway: 'proxy',
  'vulnerability management': 'security', 'vulnerability scanner': 'security', 'gestion de vulnerabilidades': 'security', 'phishing simulation': 'security', 'simulacion de phishing': 'security', 'security tooling': 'security',
  'file transfer': 'application', sftp: 'application', ftp: 'application', 'transferencia de archivos': 'application',
  erp: 'application', crm: 'application', 'lab/test application': 'application', lab: 'application', 'test application': 'application', test: 'application',
  undetermined: 'other', unknown: 'other', 'n/a': 'other', 'sin determinar': 'other',
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
