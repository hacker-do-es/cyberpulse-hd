/* Operator CLI. In Docker:
     docker exec -it cyberpulse npx tsx server/cli.ts create-superadmin <username>
     docker exec -it cyberpulse npx tsx server/cli.ts set-password <username>
     docker exec -it cyberpulse npx tsx server/cli.ts reset-totp <username>
     docker exec -it cyberpulse npx tsx server/cli.ts list-users
   Passwords are read from the terminal without echo (or from
   CYBERPULSE_NEW_PASSWORD when no terminal is attached). */

import readline from 'readline';
import { closeDb } from './db/client';
import { userRepository } from './repositories/userRepository';
import { validatePasswordStrength } from './services/auth/password';
import { createUser, disableTotp, setUserPassword, USERNAME_RE } from './services/auth/userService';

function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const fromEnv = process.env.CYBERPULSE_NEW_PASSWORD;
    if (fromEnv) return Promise.resolve(fromEnv);
    throw new Error('No terminal attached: run with -it or set CYBERPULSE_NEW_PASSWORD');
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
    let muted = false;
    rlAny._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function askNewPassword(): Promise<string> {
  const pw = await readHidden('New password: ');
  const weak = validatePasswordStrength(pw);
  if (weak) throw new Error(weak);
  if (process.stdin.isTTY) {
    const again = await readHidden('Repeat password: ');
    if (again !== pw) throw new Error('Passwords do not match');
  }
  return pw;
}

function findUser(username: string) {
  const row = userRepository.findByUsername(username);
  if (!row) throw new Error(`No user named "${username}"`);
  return row;
}

async function main() {
  const [cmd, username] = process.argv.slice(2);
  switch (cmd) {
    case 'create-superadmin': {
      if (!username || !USERNAME_RE.test(username)) throw new Error('Usage: create-superadmin <username> (3-64 chars: letters, digits, . _ @ -)');
      const password = await askNewPassword();
      await createUser({ username, password, role: 'superadmin', tenantId: null });
      console.log(`Superadmin "${username}" created.`);
      break;
    }
    case 'set-password': {
      if (!username) throw new Error('Usage: set-password <username>');
      const user = findUser(username);
      const password = await askNewPassword();
      /* Also clears the lockout and closes the user's sessions. */
      await setUserPassword(user.id, password);
      console.log(`Password updated for "${username}"; their sessions were closed.`);
      break;
    }
    case 'reset-totp': {
      if (!username) throw new Error('Usage: reset-totp <username>');
      disableTotp(findUser(username).id);
      console.log(`Two-factor authentication removed for "${username}".`);
      break;
    }
    case 'list-users': {
      console.table(userRepository.listAll().map((u) => ({ ...u, company: u.company ?? '-' })));
      break;
    }
    default:
      console.log('Commands: create-superadmin <username> | set-password <username> | reset-totp <username> | list-users');
      process.exitCode = cmd ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
