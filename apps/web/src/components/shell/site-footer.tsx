import { MotionToggle } from '@/components/motion/motion-toggle';
import { Logo } from './logo';
import { REPO_URL } from './nav-config';

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col gap-1">
          <Logo className="text-foreground" />
          <p className="text-xs">Solana devnet only. Tokens have no real value.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <MotionToggle />
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-link underline-offset-4 hover:underline">
            Source code
          </a>
        </div>
      </div>
    </footer>
  );
}
