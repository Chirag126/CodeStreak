import { CLUSTER } from '@codestreak/shared';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, service: 'codestreak-web', cluster: CLUSTER });
}
