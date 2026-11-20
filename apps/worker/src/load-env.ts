// Local development only: load the repo-root .env.local if it exists.
// On Render the variables come from the service settings and no file exists.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadLocalEnv(): string | null {
  // src/ (tsx) and dist/ (node) are both three levels below the repo root.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const file = path.join(root, '.env.local');
  if (!existsSync(file)) return null;
  process.loadEnvFile(file); // never overrides variables that are already set
  return file;
}
