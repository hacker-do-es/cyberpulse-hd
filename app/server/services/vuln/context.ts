import { assetRepository } from '../../repositories/assetRepository';
import { cveRepository } from '../../repositories/cveRepository';
import { stackRepository } from '../../repositories/stackRepository';
import { buildUnits, type VerdictContext } from './verdict';

/* Everything needed to judge one company's news: where each technology
   runs and with which version, and the cached data of the given CVEs. */
export function verdictContext(tenantId: number, cveIds: string[]): VerdictContext {
  const rows = stackRepository.listByTenant(tenantId);
  return {
    units: buildUnits(rows, assetRepository.softwareByStackItem(tenantId)),
    cpe: new Map(rows.map((r) => [r.id, r.cpe ?? null])),
    records: cveRepository.getMany(cveIds),
  };
}
