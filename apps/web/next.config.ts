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
  // Link-preview crawlers read only the first response and don't run scripts, so they must get the
  // <title>/og: tags in <head> rather than streamed in later. This extends Next's default list with
  // chat apps whose user agents it doesn't match (WhatsApp, Telegram, Signal, Teams…).
  htmlLimitedBots:
    /[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight|TelegramBot|Signal|MicrosoftPreview|Pinterest|Embedly|Iframely|mastodon|Snapchat|Viber|Line\/|KakaoTalk|Zalo|Google-InspectionTool|Googlebot|opengraph|metatags|preview/i,
};

export default nextConfig;
