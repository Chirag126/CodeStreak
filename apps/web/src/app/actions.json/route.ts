import { actionsJson } from '@codestreak/shared';
import { actionJson, actionOptions } from '@/lib/actions/http';

// Phase 39: tells Blink clients which pages are Actions (a challenge page unfurls as its join Blink).
export const dynamic = 'force-static';

export function GET() {
  return actionJson(actionsJson(), 200, { 'Cache-Control': 'public, max-age=3600' });
}

export const OPTIONS = actionOptions;
