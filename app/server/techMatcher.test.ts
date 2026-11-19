import { describe, it, expect } from 'vitest';
import { matchArticlesToStack, buildMatcher, type TechStackItem } from './techMatcher';

const art = (id: string, title: string, summary = '', category = 'NEWS') => ({ id, title, summary, category });
const stack = (...items: Array<Partial<TechStackItem> & { technology: string }>): TechStackItem[] =>
  items.map((it, i) => ({ id: i + 1, ...it }));
const matchedIds = (arts: ReturnType<typeof art>[], s: TechStackItem[]) =>
  matchArticlesToStack(arts, s).map((m) => m.article.id).sort();

describe('techMatcher', () => {
  it('matches whole words only', () => {
    const s = stack({ technology: 'Nginx', version: '1.28.0', vendor: 'F5/NGINX' });
    expect(matchedIds([
      art('a', 'Critical NGINX HTTP/2 flaw'),
      art('b', "Critical NGINX 'NGINX2Root' bugs"),
      art('c', 'Something about engines'),
    ], s)).toEqual(['a', 'b']);
  });

  it('does not match the Go language on "go" inside other words or as a verb', () => {
    const s = stack({ technology: 'Go', version: '1.25.0', vendor: 'Google' });
    expect(matchedIds([
      art('a', 'Spying on Governments with Zero Lines of Malware'),
      art('b', 'Ransomware Victim: Ginkgo Bioworks'),
      art('c', 'Published 36 minutes ago'),
      art('d', 'PoC Exploits Go Public'),
      art('e', 'Golang crypto/x509 flaw fixed in Go 1.25.4'),
      art('f', 'Malware written in Go targets Linux servers'),
    ], s)).toEqual(['e', 'f']);
  });

  it('never matches on the vendor alone', () => {
    const s = stack(
      { technology: 'TypeScript', version: '5.6.3', vendor: 'Microsoft' },
      { technology: 'Cloud KMS', vendor: 'Google' },
    );
    expect(matchedIds([
      art('a', 'Phishing scheme exploiting Microsoft outage'),
      art('b', 'Google Patches Chrome Zero-Day'),
      art('c', 'TypeScript compiler supply-chain attack'),
      art('d', 'Google Cloud KMS key rotation bug'),
    ], s)).toEqual(['c', 'd']);
  });

  it('requires context for names that are everyday words', () => {
    const s = stack({ technology: 'React', version: '19.x' }, { technology: 'Helm' }, { technology: 'Vault (secrets manager)' });
    expect(matchedIds([
      art('a', 'How defenders should react to the outbreak'),
      art('b', 'React Server Components RCE (React2Shell)'),
      art('c', 'At the helm of the new agency'),
      art('d', 'Malicious Helm charts on Artifact Hub'),
      art('e', 'Bank vault robbery'),
      art('f', 'HashiCorp Vault token bypass'),
    ], s)).toEqual(['b', 'd', 'f']);
  });

  it('ignores the language label of exploit feeds', () => {
    const s = stack({ technology: 'Python', version: '>=3.12' });
    expect(matchedIds([
      art('a', 'Vulners Software Audit exploit', 'Exploit (Python).'),
      art('b', 'CPython tarfile path traversal'),
    ], s)).toEqual(['b']);
  });

  it('cleans names: parenthetical notes, aliases, split names', () => {
    const s = stack(
      { technology: 'LiteLLM (LLM proxy)', vendor: 'BerriAI' },
      { technology: 'Node.js', version: '>=22' },
      { technology: 'Cloud Functions (2nd gen) / Cloud Run', vendor: 'Google' },
      { technology: 'Zimbra Collaboration (Web Client)', vendor: 'Synacor' },
    );
    expect(matchedIds([
      art('a', 'CISA KEV adds BerriAI LiteLLM flaw'),
      art('b', 'Node.js security release'),
      art('c', 'Cloud Run privilege escalation'),
      art('d', 'Zimbra log file to RCE'),
      art('e', 'node graph traversal'),
    ], s)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('links Oracle Critical Patch Updates to MySQL and Java', () => {
    const s = stack({ technology: 'MySQL', vendor: 'Oracle' });
    expect(matchedIds([
      art('a', 'Oracle Critical Patch Update addresses 640 CVEs'),
      art('b', 'Oracle PeopleSoft SSRF'),
    ], s)).toEqual(['a']);
  });

  it('builds no plain pattern for very short or generic names', () => {
    expect(buildMatcher({ technology: 'Go' }).patterns.every((p) => !p.test('go public'))).toBe(true);
    expect(buildMatcher({ technology: 'Google Analytics' }).patterns.some((p) => p.test('google patches chrome'))).toBe(false);
  });

  it('boosts version and vendor only after a product match', () => {
    const s = stack({ technology: 'Nginx', version: '1.28.0', vendor: 'F5' });
    const [m] = matchArticlesToStack([art('a', 'NGINX 1.28 fix from F5')], s);
    expect(m.score).toBeGreaterThan(50);
    expect(matchArticlesToStack([art('b', 'F5 BIG-IP 1.28 advisory')], s)).toEqual([]);
  });
});
