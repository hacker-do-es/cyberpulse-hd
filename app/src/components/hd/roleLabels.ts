import type { CompanyRole, Role } from '@/services/hdApi';
import { tr } from '@/lib/i18n';

/* Display names and one-line descriptions of the roles (the rules live in
   server/shared/permissions.ts). */
export function roleLabel(role: Role | undefined): string {
  switch (role) {
    case 'superadmin': return tr('Hacker-Do superadmin');
    case 'support': return tr('Hacker-Do support');
    case 'admin': return tr('Company admin');
    case 'operator': return tr('Operator');
    case 'member': return tr('Read only');
    default: return '';
  }
}

export function companyRoleHint(role: CompanyRole): string {
  switch (role) {
    case 'admin': return tr('Everything, including users and integrations (channels, AI, agent tokens, LinkedIn).');
    case 'operator': return tr('Works with the stack and assets and runs the existing channels. No users or integrations.');
    case 'member': return tr('Sees the stack, assets, agents and news. Cannot change anything.');
  }
}
