import type express from 'express';
import { getDb } from '../db/client';
import type { UserRow } from '../db/schema';
import { badRequest, conflict, idParam, isUniqueViolation, notFound, optStr } from '../lib/http';
import { sessionRepository } from '../repositories/sessionRepository';
import { userRepository, type UserUpdate } from '../repositories/userRepository';
import { validatePasswordStrength } from '../services/auth/password';
import { USERNAME_RE, createUser, setUserPassword } from '../services/auth/userService';

/* Superadmin: Hacker-Do support accounts. They belong to no company, pick one
   per session and work there as operators (see shared/permissions.ts). */

const ROLE = 'support' as const;

function userOut(u: UserRow) {
  return {
    id: u.id, username: u.username, displayName: u.displayName, role: u.role, active: u.active,
    totpEnabled: u.totpEnabled, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
  };
}

function supportOf(req: express.Request): UserRow {
  const user = userRepository.findWithRole(idParam(req), ROLE);
  if (!user) throw notFound('Support user not found');
  return user;
}

export const platformUserController = {
  list(_req: express.Request, res: express.Response) {
    res.json({ users: userRepository.listByRole(ROLE).map(userOut) });
  },

  async create(req: express.Request, res: express.Response) {
    const { username, password, displayName } = req.body ?? {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw badRequest('Username: 3-64 characters, letters, digits and . _ @ -');
    }
    const weak = validatePasswordStrength(password);
    if (weak) throw badRequest(weak);
    try {
      const id = await createUser({ username, password, role: ROLE, tenantId: null, displayName: optStr(displayName, 80) });
      res.status(201).json({ user: userOut(userRepository.findById(id)!) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('That username is taken');
      throw err;
    }
  },

  async update(req: express.Request, res: express.Response) {
    const user = supportOf(req);
    const { active, displayName, password, resetTotp } = req.body ?? {};
    if (password !== undefined) {
      const weak = validatePasswordStrength(password);
      if (weak) throw badRequest(weak);
    }
    const changes: UserUpdate = {};
    if (active !== undefined) changes.active = Boolean(active);
    if (displayName !== undefined) changes.displayName = optStr(displayName, 80);
    if (resetTotp === true) Object.assign(changes, { totpEnabled: false, totpSecret: null, totpLastStep: null });
    getDb().transaction(() => {
      userRepository.update(user.id, changes);
      if (active === false) sessionRepository.deleteForUser(user.id);
    });
    if (password !== undefined) await setUserPassword(user.id, password);
    res.json({ user: userOut(userRepository.findById(user.id)!) });
  },

  remove(req: express.Request, res: express.Response) {
    userRepository.delete(supportOf(req).id);
    res.json({ success: true });
  },
};
