import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '../..');

// Local development: the single .env.local lives at the repo root (shared with the worker).
// process.loadEnvFile never overrides variables that are already set (Render, CI).
const rootEnv = path.join(repoRoot, '.env.local');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Monorepo: trace and bundle from the repo root so workspace packages resolve.
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
};

export default nextConfig;
