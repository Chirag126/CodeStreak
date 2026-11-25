'use client';

import { MenuIcon } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogTitle, DialogTrigger, SheetContent } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { accountLinks, AuthNav, useAuthState } from '@/components/auth/auth-nav';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { Logo } from './logo';
import { NAV_ITEMS } from './nav-config';

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const auth = useAuthState();
  const account = accountLinks(auth);

  return (
    <header className="surface-glass sticky top-0 z-40 border-b border-border">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label="CodeStreak home">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active && 'text-foreground',
                )}
              >
                {active && <motion.span layoutId="nav-active" className="absolute inset-0 -z-10 rounded-md bg-muted" transition={springs.snappy} />}
                {item.label}
                {item.devOnly && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-warning">dev</span>}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="primary" tabIndex={0} className="cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="size-1.5 rounded-full bg-electric-400" aria-hidden />
                Devnet
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Solana devnet: test tokens with no real value.</TooltipContent>
          </Tooltip>

          <NotificationBell />
          <AuthNav state={auth} />

          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <MenuIcon />
              </Button>
            </DialogTrigger>
            <SheetContent>
              <DialogTitle className="sr-only">Menu</DialogTitle>
              <DialogDescription className="sr-only">Site navigation</DialogDescription>
              <Logo />
              <nav aria-label="Mobile" className="mt-4 flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                    className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              {account.length > 0 && (
                <nav aria-label="Account" className="mt-4 flex flex-col gap-1 border-t border-border pt-4">
                  {account.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                      className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              )}
            </SheetContent>
          </Dialog>
        </div>
      </div>
    </header>
  );
}
