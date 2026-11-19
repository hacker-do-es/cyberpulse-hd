import type express from 'express';
import { badRequest, conflict, idParam, isUniqueViolation, notFound, str } from '../lib/http';
import { sessionRepository } from '../repositories/sessionRepository';
import { tenantRepository } from '../repositories/tenantRepository';
import { createTenant } from '../useCases/createTenant';

function summaries(id?: number) {
  return tenantRepository.summaries(id).map((r) => ({
    id: r.id, name: r.name, language: r.language, timezone: r.timezone, active: r.active,
    aiProvider: r.aiProvider, createdAt: r.createdAt,
    counts: { users: r.users, stack: r.stack, channels: r.channels },
  }));
}

/* Superadmin: companies. */
export const adminController = {
  list(_req: express.Request, res: express.Response) {
    res.json({ tenants: summaries() });
  },

  async create(req: express.Request, res: express.Response) {
    const id = await createTenant(req.body ?? {});
    res.status(201).json({ tenant: summaries(id)[0] });
  },

  update(req: express.Request, res: express.Response) {
    const id = idParam(req);
    if (!tenantRepository.findById(id)) throw notFound('Company not found');
    const { name, active } = req.body ?? {};
    if (name !== undefined) {
      const n = str(name, 100);
      if (!n) throw badRequest('Company name is required (max 100 characters)');
      try {
        tenantRepository.update(id, { name: n });
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('A company with that name already exists');
        throw err;
      }
    }
    if (active !== undefined) {
      tenantRepository.update(id, { active: Boolean(active) });
      if (!active) sessionRepository.deleteForTenant(id);
    }
    res.json({ tenant: summaries(id)[0] });
  },

  /* Irreversible: cascades to users, stack, channels and delivery history.
     The caller must repeat the company name. */
  remove(req: express.Request, res: express.Response) {
    const id = idParam(req);
    const tenant = tenantRepository.findById(id);
    if (!tenant) throw notFound('Company not found');
    const confirm = req.body?.confirmName;
    if (typeof confirm !== 'string' || confirm.trim().toLowerCase() !== tenant.name.toLowerCase()) {
      throw badRequest('Type the company name to confirm');
    }
    tenantRepository.delete(id);
    res.json({ success: true });
  },
};
