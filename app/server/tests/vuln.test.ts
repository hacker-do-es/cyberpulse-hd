import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { compareVersions, parseVersion } from '../services/vuln/version';
import { evaluateCve, extractCves, mergeCveData, normaliseCveOrg, normaliseNvd, parseCpe } from '../services/vuln/cveData';
import { buildUnits, evaluateArticle, techKeys } from '../services/vuln/verdict';

/* Real CVE records (CVE.org JSON 5 and NVD API 2.0), trimmed copies in
   fixtures/cve: nginx (F5, "changes" per branch), PHP (per-branch ranges,
   default affected), Linux kernel (git + semver, wildcard branches),
   a WordPress plugin (Wordfence, "≤ x"). */
const dir = path.join(__dirname, 'fixtures', 'cve');
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const both = (id: string) => mergeCveData(
  normaliseCveOrg(load(`${id}.cve.json`)),
  fs.existsSync(path.join(dir, `${id}.nvd.json`)) ? normaliseNvd(load(`${id}.nvd.json`)) : null,
);
const status = (id: string, tech: string, version: string) => evaluateCve(both(id), techKeys(tech), null, version).status;

describe('version parsing', () => {
  it('parses common version shapes and refuses vendor build names', () => {
    expect(parseVersion('v1.27.3')?.nums).toEqual([1, 27, 3]);
    expect(parseVersion('1.1.1w')?.nums).toEqual([1, 1, 1, 23]);
    expect(parseVersion('24.04 LTS')?.nums).toEqual([24, 4]);
    expect(parseVersion('13 (trixie)')?.nums).toEqual([13]);
    expect(parseVersion('8.0.36-0ubuntu0.22.04.1')?.nums).toEqual([8, 0, 36]);
    expect(parseVersion('1.0.0-rc1')?.pre).toBe(true);
    for (const bad of ['25H2 (build 26200)', 'R31 P3', 'n/a', '', '3c4287f62044a90e']) expect(parseVersion(bad)).toBeNull();
  });

  it('compares, and refuses to guess when one version is a prefix of the other', () => {
    const c = (a: string, b: string) => compareVersions(parseVersion(a)!, parseVersion(b)!);
    expect(c('1.22.1', '1.27.1')).toBe(-1);
    expect(c('1.31.8', '1.27.1')).toBe(1);
    expect(c('17.5', '17.5.0')).toBe(0);
    expect(c('17.5', '17.5.1')).toBeNull();
    expect(c('1.0.0-rc1', '1.0.0')).toBe(-1);
  });

  it('extracts CVE ids and parses CPEs', () => {
    expect(extractCves('Fix for cve-2024-7347 and CVE-2024-7347, see CVE-2025-123456')).toEqual(['CVE-2024-7347', 'CVE-2025-123456']);
    expect(parseCpe('cpe:2.3:a:f5:nginx_open_source:1.27.0:*:*:*:*:*:*:*')).toEqual({ vendor: 'f5', product: 'nginx_open_source', version: '1.27.0' });
  });
});

describe('CVE evaluation against real records', () => {
  it('nginx CVE-2024-7347: fixed per branch in 1.26.2 and 1.27.1', () => {
    expect(status('CVE-2024-7347', 'nginx', '1.22.1')).toBe('affected');
    expect(status('CVE-2024-7347', 'nginx', '1.26.1')).toBe('affected');
    expect(status('CVE-2024-7347', 'nginx', '1.26.2')).toBe('not_affected');
    expect(status('CVE-2024-7347', 'nginx', '1.27.0')).toBe('affected');
    expect(status('CVE-2024-7347', 'nginx', '1.27.1')).toBe('not_affected');
    expect(status('CVE-2024-7347', 'nginx', '1.31.8')).toBe('not_affected');
    expect(evaluateCve(both('CVE-2024-7347'), techKeys('nginx'), null, '1.26.1')).toEqual({ status: 'affected', fixedIn: '1.26.2' });
  });

  it('PHP CVE-2024-4577: per-branch fixes; releases newer than the record are not affected', () => {
    expect(status('CVE-2024-4577', 'PHP', '8.1.28')).toBe('affected');
    expect(status('CVE-2024-4577', 'PHP', '8.1.29')).toBe('not_affected');
    expect(status('CVE-2024-4577', 'PHP', '8.3.7')).toBe('affected');
    expect(status('CVE-2024-4577', 'PHP', '8.5.12')).toBe('not_affected');
  });

  it('Linux kernel CVE-2024-26924: stable branches with backported fixes', () => {
    expect(status('CVE-2024-26924', 'Linux Kernel', '7.1.13')).toBe('not_affected');
    expect(status('CVE-2024-26924', 'Linux Kernel', '6.6.30')).toBe('not_affected');
    expect(status('CVE-2024-26924', 'Linux Kernel', '6.8.7')).toBe('affected');
    expect(status('CVE-2024-26924', 'Linux Kernel', '6.1.50')).toBe('affected');
    expect(status('CVE-2024-26924', 'Linux Kernel', '5.4.1')).toBe('not_affected');
  });

  it('WordPress plugin CVE-2024-8522 (LearnPress ≤ 4.2.7)', () => {
    expect(status('CVE-2024-8522', 'LearnPress', '4.2.6')).toBe('affected');
    expect(status('CVE-2024-8522', 'LearnPress', '4.2.8')).toBe('not_affected');
  });

  it('a CVE about another product is "not listed", an undecidable version "unknown"', () => {
    expect(status('CVE-2024-7347', 'PHP', '8.1.0')).toBe('not_listed');
    expect(status('CVE-2024-7347', 'nginx', '1.26')).toBe('unknown');
    expect(status('CVE-2024-7347', 'nginx', 'R31')).toBe('unknown');
  });

  it('honours an explicit vendor:product over the name', () => {
    const data = both('CVE-2024-7347');
    expect(evaluateCve(data, techKeys('Web server'), 'f5:nginx_open_source', '1.22.1').status).toBe('affected');
    expect(evaluateCve(data, techKeys('nginx'), 'f5:nginx_plus', '1.22.1').status).toBe('unknown');
  });
});

describe('article verdicts', () => {
  const asset = (id: number, name: string) => ({ id, name, criticality: 'high' as const, environment: null, hostname: null, ip: null });
  const rows = [
    { id: 1, technology: 'nginx', version: null },
    { id: 2, technology: 'PHP', version: '8.5.12' },
  ];
  const software = new Map([[1, [{ asset: asset(10, 'WEB01'), version: '1.22.1' }, { asset: asset(11, 'WEB02'), version: '1.31.8' }]]]);
  const rec = (id: string) => ({ cveId: id, status: 'ok' as const, parts: { cveOrg: null, nvd: null }, data: both(id), fetchedAt: '', nvdFetchedAt: null });
  const ctx = { units: buildUnits(rows, software), cpe: new Map(), records: new Map([['CVE-2024-7347', rec('CVE-2024-7347')]]) };

  it('names exactly the affected assets and versions', () => {
    const v = evaluateArticle(['CVE-2024-7347'], [1, 2], ctx);
    expect(v.status).toBe('affected');
    expect(v.units.filter((u) => u.status === 'affected')).toEqual([
      { stackId: 1, technology: 'nginx', version: '1.22.1', assetId: 10, status: 'affected', cve: 'CVE-2024-7347', fixedIn: '1.27.1' },
    ]);
    expect(v.units.find((u) => u.assetId === 11)?.status).toBe('not_affected');
    expect(v.units.find((u) => u.stackId === 2)?.status).toBe('not_listed');
  });

  it('is not affected once every asset is patched, pending without data, no_cve without ids', () => {
    const patched = { ...ctx, units: buildUnits(rows, new Map([[1, [{ asset: asset(10, 'WEB01'), version: '1.27.1' }]]])) };
    expect(evaluateArticle(['CVE-2024-7347'], [1], patched).status).toBe('not_affected');
    expect(evaluateArticle(['CVE-2099-0001'], [1], ctx).status).toBe('pending');
    expect(evaluateArticle([], [1], ctx).status).toBe('no_cve');
  });

  it('cannot clear a technology without a version', () => {
    const noVersion = { ...ctx, units: buildUnits([{ id: 1, technology: 'nginx', version: null }], new Map()) };
    expect(evaluateArticle(['CVE-2024-7347'], [1], noVersion).status).toBe('unverified');
  });
});

describe('F5 style per-branch ranges plus an open range for old branches', () => {
  /* Shape of CVE-2026-123007 (NGINX Open Source): fixed in 1.31.9 and
     1.30.7, every older branch from 1.9.5 left affected. */
  const data = {
    cvss: null, published: null,
    products: [{
      source: 'cna' as const, vendor: 'F5', product: 'NGINX Open Source', defaultStatus: 'unknown' as const,
      entries: [
        { status: 'affected' as const, start: '1.31.0', startIncl: true, end: '1.31.9', endIncl: false },
        { status: 'affected' as const, start: '1.30.0', startIncl: true, end: '1.30.7', endIncl: false },
        { status: 'affected' as const, start: '1.9.5', startIncl: true, end: '*', endIncl: false },
      ],
    }],
  };
  const st = (v: string) => evaluateCve(data, techKeys('nginx'), null, v);
  it('treats a branch at its fix as patched, older branches as affected', () => {
    expect(st('1.31.8')).toEqual({ status: 'affected', fixedIn: '1.31.9' });
    expect(st('1.31.9').status).toBe('not_affected');
    expect(st('1.30.7').status).toBe('not_affected');
    expect(st('1.30.6').status).toBe('affected');
    expect(st('1.22.1').status).toBe('affected');
    expect(st('1.9.4').status).toBe('not_affected');
  });
});
