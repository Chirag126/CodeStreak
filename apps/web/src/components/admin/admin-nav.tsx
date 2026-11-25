'use client';

import { Activity, ClipboardList, Coins, Gauge, Layers, Settings, ShieldAlert, ShieldCheck, Trophy, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/admin', label: 'Overview', icon: Gauge },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/challenges', label: 'Challenges', icon: Trophy },
  { href: '/admin/groups', label: 'Groups', icon: Layers },
  { href: '/admin/transactions', label: 'Transactions', icon: Coins },
  { href: '/admin/verification', label: 'Verification', icon: ShieldCheck },
  { href: '/admin/moderation', label: 'Reports & Moderation', icon: ShieldAlert },
  { href: '/admin/audit', label: 'Audit Logs', icon: ClipboardList },
  { href: '/admin/settings', label: 'Platform Settings', icon: Settings },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Control Center" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
              active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
      <span className="hidden items-center gap-2 px-3 pt-4 text-xs text-muted-foreground lg:flex">
        <Activity className="size-3.5" aria-hidden /> Every action is audited
      </span>
    </nav>
  );
}
