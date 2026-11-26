import type express from 'express';
import { getDb } from '../db/client';
import type { UserRow } from '../db/schema';
import { badRequest, conflict, idParam, isUniqueViolation, notFound, optStr, tenantOf } from '../lib/http';
import { sessionRepository } from '../repositories/sessionRepository';
import { userRepository, type UserUpdate } from '../repositories/userRepository';
import { validatePasswordStrength } from '../services/auth/password';
import { USERNAME_RE, createUser, setUserPassword } from '../services/auth/userService';
import { COMPANY_ROLES, isCompanyRole } from '../shared/permissions';

const ROLE_ERROR = `role must be one of: ${COMPANY_ROLES.join(', ')}`;

function userOut(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    active: u.active,
    totpEnabled: u.totpEnabled,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

function userOf(req: express.Request): UserRow {
  const user = userRepository.findInTenant(idParam(req), tenantOf(req));
  if (!user) throw notFound('User not found');
  return user;
}

/* A company must keep at least one active admin, unless the superadmin is
   the one making the change. */
function guardLastAdmin(req: express.Request, user: UserRow) {
  if (req.auth!.user.role === 'superadmin') return;
  if (user.role === 'admin' && userRepository.countOtherActiveAdmins(user.tenantId!, user.id) === 0) {
    throw conflict('A company needs at least one active admin');
  }
}

export const userController = {
  list(req: express.Request, res: express.Response) {
    res.json({ users: userRepository.listByTenant(tenantOf(req)).map(userOut) });
  },

  async create(req: express.Request, res: express.Response) {
    const { username, password, role, displayName } = req.body ?? {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw badRequest('Username: 3-64 characters, letters, digits and . _ @ -');
    }
    if (!isCompanyRole(role)) throw badRequest(ROLE_ERROR);
    const weak = validatePasswordStrength(password);
    if (weak) throw badRequest(weak);
    try {
      const id = await createUser({ username, password, role, tenantId: tenantOf(req), displayName: optStr(displayName, 80) });
      res.status(201).json({ user: userOut(userRepository.findById(id)!) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('That username is taken');
      throw err;
    }
  },

  async update(req: express.Request, res: express.Response) {
    const user = userOf(req);
    const { role, active, displayName, password, resetTotp } = req.body ?? {};

    if (role !== undefined) {
      if (!isCompanyRole(role)) throw badRequest(ROLE_ERROR);
      if (role !== 'admin') guardLastAdmin(req, user);
    }
    if (active === false && user.id === req.auth!.user.id) throw conflict('You cannot disable your own account');
    if (active === false) guardLastAdmin(req, user);
    if (password !== undefined) {
      const weak = validatePasswordStrength(password);
      if (weak) throw badRequest(weak);
    }

    const changes: UserUpdate = {};
    if (role !== undefined) changes.role = role;
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
    const user = userOf(req);
    if (user.id === req.auth!.user.id) throw conflict('You cannot delete your own account');
    guardLastAdmin(req, user);
    userRepository.delete(user.id);
    res.json({ success: true });
  },
};
