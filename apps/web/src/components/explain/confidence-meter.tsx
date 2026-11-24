/** 0-100 confidence with the engine's thresholds marked: ≥ 50 can verify, ≥ 80 can fail. */
export function ConfidenceMeter({ value, verify, fail, verdict }: { value: number; verify: number; fail: number; verdict: 'verified' | 'failed' | 'indeterminate' }) {
  const color = verdict === 'verified' ? 'bg-electric-400' : verdict === 'failed' ? 'bg-danger-400' : 'bg-warning-400';
  return (
    <div className="space-y-1">
      <div
        role="meter"
        aria-label="Verification confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value} out of 100`}
        className="relative h-2.5 w-full overflow-visible rounded-full bg-muted"
      >
        <div className={`h-full rounded-full ${color} transition-[width] duration-700 ease-out`} style={{ width: `${Math.max(2, value)}%` }} />
        {[verify, fail].map((t) => (
          <span key={t} aria-hidden className="absolute -top-0.5 h-3.5 w-px bg-foreground/60" style={{ left: `${t}%` }} />
        ))}
      </div>
      <div className="relative h-4 text-[10px] text-muted-foreground" aria-hidden>
        <span className="absolute -translate-x-1/2" style={{ left: `${verify}%` }}>
          {verify} pass
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${fail}%` }}>
          {fail} fail
        </span>
      </div>
    </div>
  );
}
