import type { AssetCriticality } from '@/services/apiService';
import type { AssetType } from '@/services/hdApi';
import { tr } from '@/lib/i18n';

/* Display labels for asset types and criticality (shared by the assets,
   stack, My Stack and channels screens). */

const TYPE_LABELS: Record<AssetType, string> = {
  server: 'Server', workstation: 'Workstation', laptop: 'Laptop', network: 'Network device', firewall: 'Firewall',
  cloud: 'Cloud', saas: 'SaaS', application: 'Application', database: 'Database', mobile: 'Mobile', iot: 'IoT', other: 'Other',
};

export function assetTypeLabel(t: AssetType): string {
  return tr(TYPE_LABELS[t] ?? 'Other');
}

export function criticalityLabel(c: AssetCriticality): string {
  return c === 'high' ? tr('High') : c === 'medium' ? tr('Medium') : tr('Low');
}

