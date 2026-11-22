import { describe, expect, it, vi } from 'vitest';
import { createWakeJob } from './wake.js';

const ctx = { log: () => {} };

describe('wake job', () => {
  it('records the wake in the audit log with the service role', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const job = createWakeJob({ supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'srk', version: '1', fetchImpl });
    await expect(job(ctx)).resolves.toMatchObject({ awake: true, audited: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.supabase.co/rest/v1/audit_log');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer srk');
    expect(JSON.parse(init.body as string)).toMatchObject({ actor_kind: 'worker', action: 'worker.wake' });
  });

  it('still wakes without Supabase configured', async () => {
    await expect(createWakeJob({ version: '1' })(ctx)).resolves.toMatchObject({ awake: true, audited: false });
  });

  it('fails loudly if the audit write fails', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    await expect(createWakeJob({ supabaseUrl: 'https://x', serviceRoleKey: 'k', version: '1', fetchImpl })(ctx)).rejects.toThrow(/401/);
  });
});
