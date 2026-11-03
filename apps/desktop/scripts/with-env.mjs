// Tiny cross-platform "VAR=value command": node scripts/with-env.mjs VAR=value -- command args
import { spawnSync } from 'node:child_process';

const separator = process.argv.indexOf('--');
const assignments = process.argv.slice(2, separator);
const [command, ...args] = process.argv.slice(separator + 1);
const env = { ...process.env };
for (const assignment of assignments) {
  const [key, ...value] = assignment.split('=');
  env[key] = value.join('=');
}
const result = spawnSync(command, args, { env, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
