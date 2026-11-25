/* The inventory report an agent sends: plain text, one record per line,
   fields separated by tabs. Plain text keeps the agents dependency-free (no
   jq or JSON escaping in bash/PowerShell).

     agent    <agent version>
     host     <hostname>
     fqdn     <fully qualified name>
     machine  <sha256 of the machine id>
     type     server | workstation | laptop
     os       <ID> <ID_LIKE> <VERSION_ID> <PRETTY_NAME>       (Linux os-release)
     winos    <Caption> <10.0.build.ubr>                       (Windows)
     kernel   <uname -r>
     vendor   <hardware vendor>      model  <hardware model>
     ip       <address>
     pkg      <dpkg|rpm|apk> <name> <version> <source name> <source version>
     app      <DisplayName> <DisplayVersion> <Publisher>        (Windows)
     image    <image reference> <org.opencontainers.image.version label>

   And what of it becomes technologies (see catalog.ts). */

import { catalogFor, windowsTech, type CatalogEntry } from './catalog';

export interface ParsedReport {
  agentVersion: string | null;
  hostname: string | null;
  fqdn: string | null;
  machineId: string | null;
  type: 'server' | 'workstation' | 'laptop' | null;
  os: { id: string; idLike: string; versionId: string; pretty: string } | null;
  winOs: { caption: string; build: string } | null;
  kernel: string | null;
  vendor: string | null;
  model: string | null;
  ips: string[];
  packages: Array<{ source: 'dpkg' | 'rpm' | 'apk'; name: string; version: string; srcName: string; srcVersion: string }>;
  apps: Array<{ name: string; version: string; publisher: string }>;
  images: Array<{ ref: string; label: string }>;
}

export class ReportError extends Error {}

const MAX_LINES = 30_000;
const MAX_FIELD = 300;

function clean(s: string | undefined): string {
  return (s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_FIELD);
}

export function parseReport(text: string): ParsedReport {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines.length > MAX_LINES) throw new ReportError(`Report too long (max ${MAX_LINES} lines)`);
  const r: ParsedReport = {
    agentVersion: null, hostname: null, fqdn: null, machineId: null, type: null, os: null, winOs: null,
    kernel: null, vendor: null, model: null, ips: [], packages: [], apps: [], images: [],
  };
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [key, ...rest] = line.split('\t');
    const f = rest.map(clean);
    switch (key.trim()) {
      case 'agent': r.agentVersion = f[0] || null; break;
      case 'host': r.hostname = f[0] || null; break;
      case 'fqdn': r.fqdn = f[0] || null; break;
      case 'machine': if (/^[a-f0-9]{64}$/i.test(f[0] ?? '')) r.machineId = f[0].toLowerCase(); break;
      case 'type': if (['server', 'workstation', 'laptop'].includes(f[0])) r.type = f[0] as ParsedReport['type']; break;
      case 'os': r.os = { id: (f[0] || '').toLowerCase(), idLike: (f[1] || '').toLowerCase(), versionId: f[2] || '', pretty: f[3] || '' }; break;
      case 'winos': r.winOs = { caption: f[0] || '', build: f[1] || '' }; break;
      case 'kernel': r.kernel = f[0] || null; break;
      case 'vendor': r.vendor = f[0] || null; break;
      case 'model': r.model = f[0] || null; break;
      case 'ip': if (f[0] && r.ips.length < 16) r.ips.push(f[0]); break;
      case 'pkg':
        if (['dpkg', 'rpm', 'apk'].includes(f[0]) && f[1] && f[2]) {
          r.packages.push({ source: f[0] as 'dpkg' | 'rpm' | 'apk', name: f[1], version: f[2], srcName: f[3] || f[1], srcVersion: f[4] || f[2] });
        }
        break;
      case 'app': if (f[0]) r.apps.push({ name: f[0], version: f[1] || '', publisher: f[2] || '' }); break;
      case 'image': if (f[0]) r.images.push({ ref: f[0], label: f[1] || '' }); break;
      default: break;
    }
  }
  if (!r.hostname) throw new ReportError('The report has no host name');
  if (!r.machineId) throw new ReportError('The report has no machine id');
  return r;
}

/* ------------------------------------------------------------------ */
/*  Package → technology                                               */
/* ------------------------------------------------------------------ */

export interface MappedTech {
  entry: Pick<CatalogEntry, 'tech' | 'vendor' | 'category'>;
  /* What CVE ranges are compared with (upstream version). */
  version: string | null;
  /* "Debian:13|openssh|1:10.0p1-7" when OSV can judge the distro package;
     "rpm|openssh|9.6p1-1.el9" (no OSV ecosystem) when it cannot. */
  package: string | null;
}

/* OSV ecosystem of a Linux distribution, when OSV publishes CVE-level
   records for it (Debian/Ubuntu/Alpine ids embed the CVE id). */
export function osvEcosystem(os: ParsedReport['os']): string | null {
  if (!os) return null;
  const like = `${os.id} ${os.idLike}`;
  if (os.id === 'debian' && /^\d+/.test(os.versionId)) return `Debian:${os.versionId.match(/^\d+/)![0]}`;
  if (/\bubuntu\b/.test(like) && /^\d{2}\.\d{2}$/.test(os.versionId)) {
    const [y, m] = os.versionId.split('.').map(Number);
    return y % 2 === 0 && m === 4 ? `Ubuntu:${os.versionId}:LTS` : `Ubuntu:${os.versionId}`;
  }
  if (os.id === 'alpine' && /^\d+\.\d+/.test(os.versionId)) return `Alpine:v${os.versionId.match(/^\d+\.\d+/)![0]}`;
  return null;
}

/* "1:9.6p1-3ubuntu13" → "9.6p1"; "3.0.11-1~deb12u2" → "3.0.11";
   "8.5.12-r0" (apk) → "8.5.12"; rpm "9.6p1-1.el9" → "9.6p1". */
export function upstreamVersion(v: string): string {
  return v.replace(/^\d+:/, '').replace(/-[^-]*$/, '').replace(/[+~].*$/, '');
}

/* Image tag or OCI version label → version, when it looks like one. */
function imageVersion(ref: string, label: string): string | null {
  const fromLabel = label.match(/^v?(\d+(?:\.\d+)+)/);
  if (fromLabel) return fromLabel[1];
  const tag = ref.includes('@') ? '' : (ref.split('/').pop() ?? '').split(':')[1] ?? '';
  const m = tag.match(/^v?(\d+(?:\.\d+)+)/);
  return m ? m[1] : null;
}

/* "ghcr.io/linuxserver/plex:1.43" → "linuxserver/plex"; "nginx:1.27" → "nginx". */
export function imageName(ref: string): string {
  let r = ref.split('@')[0];
  const parts = r.split('/');
  if (parts.length > 1 && /[.:]/.test(parts[0]) || parts[0] === 'localhost') parts.shift();
  r = parts.join('/');
  return r.replace(/:[^/]*$/, '').toLowerCase();
}

function better(a: MappedTech, b: MappedTech): boolean {
  /* Keep the newest version when several packages map to one technology
     (python3.11 and python3.12): one version per asset and technology. */
  const pa = (a.version ?? '').split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  const pb = (b.version ?? '').split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

export function mapReport(r: ParsedReport): MappedTech[] {
  const byTech = new Map<string, MappedTech>();
  const put = (m: MappedTech) => {
    const prev = byTech.get(m.entry.tech);
    if (!prev || better(m, prev)) byTech.set(m.entry.tech, m);
  };
  const eco = osvEcosystem(r.os);

  for (const p of r.packages) {
    const e = catalogFor(p.source, p.name);
    if (!e) continue;
    const pkg = eco && p.source !== 'rpm'
      ? `${eco}|${p.srcName}|${p.srcVersion}`
      : `${p.source}|${p.srcName}|${p.srcVersion}`;
    put({ entry: e, version: upstreamVersion(p.version), package: pkg });
  }
  for (const a of r.apps) {
    const e = catalogFor('win', a.name);
    if (e) put({ entry: e, version: a.version || null, package: null });
  }
  for (const i of r.images) {
    const e = catalogFor('image', imageName(i.ref));
    if (e) put({ entry: e, version: imageVersion(i.ref, i.label), package: null });
  }
  if (r.kernel && !r.winOs) {
    const v = r.kernel.match(/^(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null;
    put({ entry: { tech: 'Linux Kernel', vendor: 'Linux Foundation', category: 'Operating system' }, version: v, package: null });
  }
  if (r.winOs) {
    const tech = windowsTech(r.winOs.caption);
    if (tech) put({ entry: { tech, vendor: 'Microsoft', category: 'Operating system' }, version: /^10\.0\.\d+\.\d+$/.test(r.winOs.build) ? r.winOs.build : null, package: null });
  }
  return Array.from(byTech.values());
}
