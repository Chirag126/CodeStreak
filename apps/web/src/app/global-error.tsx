'use client';

/** Last resort when the root layout itself fails (no app styles are guaranteed here). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#0b1120', color: '#e5e7eb', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ maxWidth: 440, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22 }}>CodeStreak couldn&apos;t load</h1>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Something failed while starting the page. Your funds and records are safe on-chain.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button onClick={reset} style={{ padding: '8px 14px', borderRadius: 8, border: 0, background: '#a3e635', color: '#0b1120', fontWeight: 600 }}>
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/dashboard" style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #334155', color: '#e5e7eb', textDecoration: 'none' }}>
              Dashboard
            </a>
          </div>
          {error.digest && <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b', marginTop: 16 }}>Reference: {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
