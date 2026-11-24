import { explainReceipt, type DayExplanation, type DayReceipt } from '@codestreak/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ConfidenceMeter } from './confidence-meter';

const VERDICT_BADGE = {
  verified: { label: 'Passed', variant: 'success' },
  failed: { label: 'Failed', variant: 'danger' },
  indeterminate: { label: 'Undecided', variant: 'warning' },
} as const;

const short = (id: string) => (id.length > 12 ? `${id.slice(0, 7)}…` : id);

/** Challenge page: why each of your recorded days passed, failed or was undecided, from its sealed receipt. */
export async function MyDaysExplained({ membershipId }: { membershipId: string }) {
  const supabase = await createSupabaseServerClient();
  const [{ data: receipts }, { data: shields }] = await Promise.all([
    supabase.from('day_receipts').select('day, engine, receipt, evidence_hash').eq('membership_id', membershipId).order('day'),
    supabase.from('shields').select('day').eq('membership_id', membershipId),
  ]);
  const shielded = new Set((shields ?? []).map((s) => s.day as number));
  type Row = { day: number; dispute: true; hash: string } | { day: number; dispute: false; hash: string; x: DayExplanation };
  const days = (receipts ?? []).flatMap((r): Row[] => {
    if (r.engine !== 'codestreak-rules/1') return [{ day: r.day as number, dispute: true, hash: r.evidence_hash as string }];
    try {
      return [{ day: r.day as number, dispute: false, hash: r.evidence_hash as string, x: explainReceipt(JSON.parse(r.receipt as string) as DayReceipt) }];
    } catch {
      return [];
    }
  });
  if (!days.length) return null;

  return (
    <Card id="my-days" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-base">Your days, explained</CardTitle>
        <CardDescription>
          Each recorded day, straight from its sealed receipt (the same data whose hash is stored on-chain): what was counted, what wasn&apos;t and why, and how sure the
          engine was.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {days.map((d) =>
          d.dispute ? (
            <div key={d.day} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">
                Day {d.day + 1} <Badge variant="success">Passed</Badge>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Verified after an approved dispute (see Dashboard → Disputes).</p>
            </div>
          ) : (
            <details key={d.day} className="group rounded-lg border border-border p-3 text-sm" open={d.x.verdict !== 'verified'}>
              <summary className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{d.x.headline}</span>
                <span className="flex items-center gap-2">
                  {shielded.has(d.day) && d.x.verdict !== 'verified' && <Badge variant="accent">Covered by a Shield</Badge>}
                  <Badge variant={VERDICT_BADGE[d.x.verdict].variant}>{VERDICT_BADGE[d.x.verdict].label}</Badge>
                  <span className="tabular-nums text-xs text-muted-foreground">confidence {d.x.confidence}</span>
                </span>
              </summary>
              <div className="mt-3 space-y-3">
                <ConfidenceMeter value={d.x.confidence} verify={d.x.thresholds.verify} fail={d.x.thresholds.fail} verdict={d.x.verdict} />
                <p>
                  {d.x.reasonText} {d.x.ruleText}
                </p>
                <p className="text-xs text-muted-foreground">{d.x.gateText}</p>
                {d.x.providers.map((p) => (
                  <div key={p.provider} className="space-y-1.5 rounded-md bg-muted/40 p-2.5">
                    <p className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">
                        {p.label}: {p.outcomeText}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {p.value} / {p.goal} {p.unit} · confidence {p.confidence}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">{p.confidenceWhy}</p>
                    {p.counted.length > 0 && (
                      <ul className="space-y-0.5 text-xs">
                        {p.counted.map((e) => (
                          <li key={e.id}>
                            <span className="text-success">✓</span> <span className="font-mono">{short(e.id)}</span> {e.ref && <span className="text-muted-foreground">{e.ref}</span>}
                            {e.value !== undefined && p.provider === 'github' && <span className="text-muted-foreground"> · {e.value} lines</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.skipped.length > 0 && (
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {p.skipped.map((e) => (
                          <li key={e.id}>
                            ✕ <span className="font-mono">{short(e.id)}</span> {e.ref && <span>{e.ref} · </span>}
                            {e.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.omitted > 0 && <p className="text-xs text-muted-foreground">…and {p.omitted} more (counted in the total).</p>}
                  </div>
                ))}
                <p className="break-all font-mono text-[10px] text-muted-foreground">
                  Evidence hash {d.hash}
                  {!d.x.consistent && <span className="text-destructive-text"> · the stored numbers don&apos;t match a fresh calculation</span>}
                </p>
              </div>
            </details>
          ),
        )}
      </CardContent>
    </Card>
  );
}
