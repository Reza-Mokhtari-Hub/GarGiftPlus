import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const devVarsPath = join(root, '.dev.vars');
const migratedMarker = join(root, '.wrangler', 'state', '.d1-migrated');

// 1. Ensure .dev.vars has local secrets so encrypted vault + sessions work out of the box.
let devVars = existsSync(devVarsPath) ? readFileSync(devVarsPath, 'utf8') : '';
let changed = false;
for (const key of ['SECRETS_KEK', 'AUTH_SECRET']) {
  if (!new RegExp(`^${key}=`, 'm').test(devVars)) {
    if (devVars.length > 0 && !devVars.endsWith('\n')) devVars += '\n';
    devVars += `${key}=${randomBytes(32).toString('base64')}\n`;
    changed = true;
  }
}
if (changed || !existsSync(devVarsPath)) {
  writeFileSync(devVarsPath, devVars, 'utf8');
}

// 2. Ensure local D1 has all migrations applied (handles fresh/ephemeral container state).
if (!existsSync(migratedMarker)) {
  console.log('[minshop] Applying local D1 migrations...');
  execSync('npx wrangler d1 migrations apply DB --local', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  });
  mkdirSync(join(root, '.wrangler', 'state'), { recursive: true });
  writeFileSync(migratedMarker, `${new Date().toISOString()}\n`, 'utf8');
}
