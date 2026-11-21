/**
 * Technology Stack Matching Service
 *
 * Decides which news articles concern a company's technology stack.
 *
 * Precision matters more than recall here: every match ends up in a
 * customer's alert channel. So:
 *  - terms match whole words only ("go" never matches "governments"/"ago",
 *    "ios" never matches "scenarios");
 *  - names that are ordinary English words or too short ("Go", "React",
 *    "Helm", "Vault", ...) only match together with a qualifying phrase
 *    ("golang", "React Native", "Helm chart", "HashiCorp Vault", ...);
 *  - the vendor never matches on its own (a "Microsoft" or "Google" headline
 *    is not news about TypeScript or Cloud KMS); it only boosts the score of
 *    an article that already matched the product.
 */

export interface TechStackItem {
  id: number;
  technology: string;
  version?: string;
  vendor?: string;
  category?: string;
}

export interface Article {
  id: string;
  title: string;
  summary: string;
  category: string;
}

/* Normalised key: lowercase letters and digits only ("Node.js" -> "nodejs"). */
function keyOf(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* Extra names a product is known by. Keyed by normalised technology name. */
const ALIASES: Record<string, string[]> = {
  php: ['php', 'php7', 'php8', 'php-fpm', 'php-cgi'],
  apachehttpserver: ['apache http server', 'apache httpd', 'httpd', 'apache web server', 'apache2'],
  apachehttpd: ['apache http server', 'apache httpd', 'httpd', 'apache web server', 'apache2'],
  wordpress: ['wordpress', 'wp-core'],
  mysql: ['mysql', 'mariadb', 'percona', 'oracle critical patch update', 'oracle critical security patch update', 'oracle cpu'],
  nginx: ['nginx'],
  openssl: ['openssl'],
  java: ['java', 'jdk', 'jre', 'openjdk', 'oracle critical patch update', 'oracle critical security patch update', 'oracle cpu'],
  python: ['python', 'python2', 'python3', 'cpython'],
  nodejs: ['nodejs', 'node.js'],
  node: ['nodejs', 'node.js'],
  docker: ['docker', 'docker-ce', 'containerd', 'docker desktop', 'docker engine'],
  kubernetes: ['kubernetes', 'k8s', 'kubelet', 'kube-apiserver'],
  redis: ['redis', 'redis-server'],
  postgresql: ['postgresql', 'postgres', 'pgsql'],
  postgres: ['postgresql', 'postgres', 'pgsql'],
  mongodb: ['mongodb'],
  elasticsearch: ['elasticsearch', 'elastic search'],
  jenkins: ['jenkins'],
  gitlab: ['gitlab', 'gitlab-ce', 'gitlab-ee'],
  tomcat: ['tomcat', 'apache tomcat'],
  django: ['django'],
  rails: ['ruby on rails', 'rails framework', 'rails application'],
  rubyonrails: ['ruby on rails'],
  fortinet: ['fortinet', 'fortigate', 'fortios'],
  fortigate: ['fortigate', 'fortios', 'fortinet firewall'],
  fortios: ['fortios', 'fortigate'],
  paloalto: ['palo alto networks', 'pan-os', 'globalprotect'],
  panos: ['pan-os', 'palo alto networks'],
  cisco: ['cisco'],
  windows: ['windows', 'windows server', 'microsoft windows'],
  linux: ['linux'],
  linuxkernel: ['linux kernel'],
  ubuntu: ['ubuntu'],
  debian: ['debian'],
  centos: ['centos', 'rhel', 'red hat enterprise linux'],
  typescript: ['typescript'],
  sentrysdk: ['sentry sdk', 'sentry-sdk', 'sentry'],
  sentry: ['sentry'],
  erlangotp: ['erlang/otp', 'erlang otp', 'erlang'],
  shadcnuiradixui: ['shadcn', 'radix ui', 'radix-ui'],
  mcpmodelcontextprotocolsdk: ['mcp sdk', 'model context protocol sdk', 'mcp typescript sdk', 'mcp python sdk', '@modelcontextprotocol/sdk'],
  litellmllmproxy: ['litellm'],
  anthropicclaudeinclclaudecodecli: ['claude code', 'anthropic claude', 'claude ai'],
  cloudmemorystoreredis: ['memorystore'],
  googlekubernetesenginegkestandard: ['gke', 'google kubernetes engine'],
  cloudstoragegcs: ['google cloud storage', 'gcs bucket', 'gcs buckets'],
  cloudmonitoringinclmanagedprometheus: ['cloud monitoring', 'managed prometheus'],
  cloudfunctions2ndgencloudrun: ['cloud functions', 'cloud run'],
  googlegeminiviavertexai: ['gemini', 'vertex ai'],
  externalsecretsoperatoreso: ['external secrets operator', 'external-secrets'],
  zimbracollaborationwebclient: ['zimbra'],
  miniocompatibleobjectstoragesilofork: ['minio'],
  microsoftentraid: ['entra id', 'azure ad', 'azure active directory'],
  microsoftentraidindication: ['entra id', 'azure ad', 'azure active directory'],
  amazonec2: ['amazon ec2', 'aws ec2', 'ec2'],
};

/* Names that are everyday words (or too short) to trust on their own. Such a
   name matches only when one of these qualifying phrases appears. Patterns
   are regular-expression fragments, matched as whole words. */
const AMBIGUOUS: Record<string, string[]> = {
  go: ['golang', 'go programming language', 'go language', 'go modules?', 'go toolchain', 'go compiler',
    'go standard library', 'go stdlib', 'go runtime', 'go binary', 'go binaries', 'go 1\\.\\d+', 'go1\\.\\d+',
    'go-based', 'written in go', 'go version'],
  react: ['react\\.js', 'reactjs', 'react native', 'react-dom', 'react server components?', 'react router',
    'react2shell', 'react framework', 'react library', 'react app(lication)?s?', 'react 1\\d'],
  helm: ['helm charts?', 'kubernetes helm', 'helm v?3', 'helm cli', 'helm package manager'],
  phoenix: ['phoenix framework', 'phoenix liveview', 'elixir phoenix', 'phoenix web framework'],
  phoenixliveview: ['phoenix liveview', 'liveview'],
  railway: ['railway\\.app', 'railway platform', 'railway hosting'],
  vault: ['hashicorp vault', 'openbao', 'vault server'],
  meteor: ['meteor\\.js', 'meteorjs', 'meteor framework', 'meteor app(lication)?s?'],
  bandit: ['pycqa bandit', 'bandit sast', 'bandit linter', 'bandit security linter'],
  hono: ['hono framework', 'hono\\.js', 'honojs'],
  popper: ['popper\\.js', 'popperjs'],
  bootstrap: ['twitter bootstrap', 'bootstrap css', 'bootstrap framework', 'bootstrap [345]', 'bootstrap\\.js', 'getbootstrap'],
  astratheme: ['astra theme', 'astra wordpress theme'],
  spring: ['spring framework', 'spring boot', 'spring security', 'spring cloud', 'spring4shell', 'vmware spring'],
  apache: ['apache http server', 'apache httpd', 'httpd', 'apache web server', 'apache2'],
};

/* First words that name a vendor or a generic concept, never a product on
   their own ("Google Kubernetes Engine" must not match every Google story). */
const GENERIC_WORDS = new Set([
  'google', 'microsoft', 'amazon', 'aws', 'azure', 'apache', 'oracle', 'ibm', 'meta', 'openai', 'anthropic',
  'slack', 'github', 'hashicorp', 'cloud', 'contact', 'font', 'identity', 'external', 'workload', 'country',
  'webmail', 'secret', 'secrets', 'artifact', 'vertex', 'web', 'open', 'data', 'the', 'sql', 'mail', 'phone',
  'managed', 'model', 'agent', 'agents', 'security', 'server', 'service', 'services', 'platform', 'core',
  'jquery', 'vault', 'phoenix', 'react', 'go',
  'helm', 'spring', 'bootstrap', 'popper', 'railway', 'meteor', 'bandit', 'hono', 'astra', 'minio',
]);

const MIN_PLAIN_TERM = 3;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Whole-word pattern. A letter may not follow the term but a digit may, so
   "nginx" still matches "NGINX2Root" and "php" matches "php8". */
function wordPattern(fragment: string): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${fragment})(?![a-z])`, 'i');
}

/* Display name without parenthetical notes: "LiteLLM (LLM proxy)" -> "LiteLLM". */
function baseName(technology: string): string {
  return technology.replace(/\([^)]*\)?/g, ' ').replace(/['"]/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface TechMatcher {
  /* Whole-word patterns; any hit counts as a match. */
  patterns: RegExp[];
  /* Base product name, used for the "named in the title" boost. */
  titlePattern: RegExp | null;
}

/**
 * Builds the patterns that identify one stack item in article text.
 * Exported for tests.
 */
export function buildMatcher(item: Pick<TechStackItem, 'technology'>): TechMatcher {
  const full = item.technology.trim();
  const key = keyOf(full);
  const base = baseName(full).toLowerCase();
  const baseKey = keyOf(base);

  const ambiguous = AMBIGUOUS[key] ?? AMBIGUOUS[baseKey];
  if (ambiguous) {
    const patterns = ambiguous.map(wordPattern);
    return { patterns, titlePattern: patterns.length ? patterns[0] : null };
  }

  const terms = new Set<string>();
  const aliases = ALIASES[key] ?? ALIASES[baseKey];
  if (aliases) aliases.forEach((a) => terms.add(a));

  /* "Cloud Functions / Cloud Run", "shadcn/ui + Radix UI" -> each part. */
  const parts = base.split(/\s+[/+&]\s+|\s*,\s*/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const partKey = keyOf(part);
    if (AMBIGUOUS[partKey]) continue;
    if (partKey.length >= MIN_PLAIN_TERM) terms.add(part);
    if (ALIASES[partKey]) ALIASES[partKey].forEach((a) => terms.add(a));

    /* "Zimbra Collaboration" -> also "zimbra"; never "google", "cloud", ... */
    const words = part.split(/\s+/);
    if (words.length > 1) {
      const first = words[0].replace(/[^a-z0-9.-]/g, '');
      const firstKey = keyOf(first);
      if (firstKey.length >= 4 && !GENERIC_WORDS.has(firstKey) && !AMBIGUOUS[firstKey]) terms.add(first);
    }
    /* "Erlang/OTP" -> also "erlang"; "shadcn/ui" -> "shadcn". */
    if (/^[a-z0-9.-]+\/[a-z0-9.-]+$/.test(part)) {
      const head = part.split('/')[0];
      if (keyOf(head).length >= 4 && !GENERIC_WORDS.has(keyOf(head))) terms.add(head);
    }
  }

  const patterns = Array.from(terms)
    .filter((t) => keyOf(t).length >= 2)
    .map((t) => wordPattern(escapeRe(t)));
  const titlePattern = keyOf(base).length >= MIN_PLAIN_TERM && !GENERIC_WORDS.has(keyOf(base))
    ? wordPattern(escapeRe(base))
    : null;
  return { patterns, titlePattern };
}

/* Exploit feeds label the exploit's own language ("Exploit (Python).");
   that says nothing about the product being affected. */
function cleanContent(text: string): string {
  return text.replace(/\bexploit\s*\([^)]{1,24}\)/gi, 'exploit');
}

/**
 * Check if a version string matches the user's version
 * Examples:
 *   matchVersion("7.4", "PHP 7.4.33") -> true
 *   matchVersion("7.4", "PHP 8.0") -> false
 */
function matchVersion(userVersion: string, content: string): boolean {
  const m = userVersion.match(/\d+(?:\.\d+)+/);
  if (!m) return false;
  const parts = m[0].split('.');
  const majorMinor = `${parts[0]}.${parts[1]}`;
  return new RegExp(`(?<![0-9.])${escapeRe(majorMinor)}(?![0-9])`).test(content);
}

function calculateMatchScore(article: Article, content: string, techItem: TechStackItem, matcher: TechMatcher): number {
  let keywordMatches = 0;
  for (const p of matcher.patterns) if (p.test(content)) keywordMatches++;
  if (keywordMatches === 0) return 0;

  let score = keywordMatches * 10;
  if (techItem.version && matchVersion(techItem.version, content)) score += 50;
  if (matcher.titlePattern?.test(cleanContent(article.title))) score += 20;
  if (techItem.vendor && content.includes(techItem.vendor.toLowerCase())) score += 15;
  const criticalCategories = ['VULNERABILITY', 'EXPLOIT', 'MALWARE', 'ALERT'];
  if (criticalCategories.includes(article.category)) score += 10;
  return score;
}

export interface StackMatch<A extends Article = Article> {
  article: A;
  score: number;
  matchedTech: string[];
  /* Ids of the stack rows that matched (to look up their assets). */
  matchedIds: number[];
}

/* A stack with every matcher built once, reused for every article. */
export interface CompiledStack {
  items: Array<{ tech: TechStackItem; matcher: TechMatcher }>;
}

export function compileStack(techStack: TechStackItem[]): CompiledStack {
  return { items: techStack.map((tech) => ({ tech, matcher: buildMatcher(tech) })) };
}

/* Scores one article against the stack; null when nothing matches. */
export function matchArticle<A extends Article>(article: A, stack: CompiledStack): StackMatch<A> | null {
  const content = cleanContent(`${article.title} ${article.summary}`).toLowerCase();
  let totalScore = 0;
  const matchedTech: string[] = [];
  const matchedIds: number[] = [];
  for (const { tech, matcher } of stack.items) {
    const score = calculateMatchScore(article, content, tech, matcher);
    if (score > 0) {
      totalScore += score;
      matchedTech.push(tech.technology);
      matchedIds.push(tech.id);
    }
  }
  return totalScore > 0 ? { article, score: totalScore, matchedTech: Array.from(new Set(matchedTech)), matchedIds } : null;
}

export function sortMatches<A extends Article>(matches: StackMatch<A>[]): StackMatch<A>[] {
  return matches.sort((a, b) => b.score - a.score);
}

/* Synchronous convenience for small inputs (tests, a single article). For
   whole-corpus scans use services/stackNews.ts, which yields to the event
   loop between chunks. */
export function matchArticlesToStack<A extends Article>(articles: A[], techStack: TechStackItem[]): StackMatch<A>[] {
  if (techStack.length === 0) return [];
  const compiled = compileStack(techStack);
  const matches: StackMatch<A>[] = [];
  for (const article of articles) {
    const m = matchArticle(article, compiled);
    if (m) matches.push(m);
  }
  return sortMatches(matches);
}

export interface StackStatistics {
  totalArticles: number;
  matchedArticles: number;
  byTechnology: Record<string, number>;
  bySeverity: Record<string, number>;
}

/* Statistics from matches already computed (no second matching pass). */
export function statisticsFromMatches(totalArticles: number, matches: StackMatch[]): StackStatistics {
  const byTechnology: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const { article, matchedTech } of matches) {
    for (const tech of matchedTech) byTechnology[tech] = (byTechnology[tech] || 0) + 1;
    /* Keyed by category, as the UI's "top category" card expects. */
    bySeverity[article.category] = (bySeverity[article.category] || 0) + 1;
  }
  return { totalArticles, matchedArticles: matches.length, byTechnology, bySeverity };
}

export function getStackStatistics(articles: Article[], techStack: TechStackItem[]): StackStatistics {
  return statisticsFromMatches(articles.length, matchArticlesToStack(articles, techStack));
}
