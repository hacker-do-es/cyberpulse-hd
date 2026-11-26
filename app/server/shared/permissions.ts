/* Who may do what. The single source of truth for every guard on the server
   and every button in the UI: adding or changing a role means editing this
   file only.

   Platform roles (no company of their own, pick one per session):
     superadmin  Hacker-Do owner: everything.
     support     Hacker-Do staff: works inside any company as an operator and
                 reads the audit log; cannot manage companies, feeds or users.
   Company roles:
     admin       everything inside the company: users and integrations
                 (channels, AI provider, agent tokens, LinkedIn).
     operator    day-to-day work: any change to the stack and the assets,
                 running existing channels, generating content and proposing
                 LinkedIn posts. No users, no integrations.
     member      read only ("Lector" in the UI). */

export const ROLES = ['superadmin', 'support', 'admin', 'operator', 'member'] as const;
export type Role = (typeof ROLES)[number];

/* Roles that belong to no company. */
export const PLATFORM_ROLES: readonly Role[] = ['superadmin', 'support'];
/* Roles a company admin can hand out. */
export const COMPANY_ROLES = ['admin', 'operator', 'member'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const PERMISSIONS = [
  /* Platform */
  'platform.tenants',        // create, edit, delete companies
  'platform.feeds',          // RSS sources and scraping
  'platform.logs',           // audit / application log
  'platform.switchTenant',   // pick the company to work on
  'platform.users',          // support accounts
  /* Company */
  'inventory.read',          // stack, assets, agents and their reports
  'inventory.write',         // any change to stack and assets (incl. delete, CSV replace, merge)
  'channels.read',           // list channels (secrets masked) and deliveries
  'channels.run',            // send now / test an existing channel
  'channels.manage',         // create, edit, delete channels
  'settings.manage',         // company settings and AI provider/key
  'agents.tokens',           // inventory agent tokens (credentials)
  'users.manage',            // company users
  'content.generate',        // AI generation, digests, propose LinkedIn posts
  'linkedin.connect',        // connect a LinkedIn account (an integration)
  'linkedin.approve',        // approve / reject / publish LinkedIn posts
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OPERATOR: Permission[] = [
  'inventory.read', 'inventory.write', 'channels.read', 'channels.run', 'content.generate',
];

const ADMIN: Permission[] = [
  ...OPERATOR, 'channels.manage', 'settings.manage', 'agents.tokens', 'users.manage',
  'linkedin.connect', 'linkedin.approve',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  superadmin: PERMISSIONS,
  support: ['platform.logs', 'platform.switchTenant', ...OPERATOR],
  admin: ADMIN,
  operator: OPERATOR,
  member: ['inventory.read'],
};

export function can(role: Role | undefined | null, perm: Permission): boolean {
  return Boolean(role && ROLE_PERMISSIONS[role]?.includes(perm));
}

export function isPlatformRole(role: Role | undefined | null): boolean {
  return Boolean(role && PLATFORM_ROLES.includes(role));
}

export function isCompanyRole(value: unknown): value is CompanyRole {
  return typeof value === 'string' && (COMPANY_ROLES as readonly string[]).includes(value);
}
