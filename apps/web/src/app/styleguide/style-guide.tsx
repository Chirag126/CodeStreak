'use client';

// Development-only catalogue of every design-system piece. Values shown here are samples.
import { FlameIcon, InfoIcon, TimerIcon, TrophyIcon, UsersIcon, WalletIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useMotionPreference } from '@/components/motion/motion-preference';
import { MotionToggle } from '@/components/motion/motion-toggle';
import { AnimatedNumber, Reveal, Stagger, StaggerItem } from '@/components/motion/primitives';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Stat } from '@/components/ui/stat';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TokenAmount } from '@/components/ui/token-amount';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { contrastRatio } from '@/design/contrast';
import { CONTRAST_PAIRS, palette, semantic } from '@/design/tokens';

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-4">
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const SECTIONS = ['colors', 'contrast', 'type', 'buttons', 'badges', 'cards', 'forms', 'overlays', 'feedback', 'motion'] as const;

export function StyleGuide() {
  const { reduce, preference } = useMotionPreference();
  const [replay, setReplay] = useState(0);
  const [count, setCount] = useState(1284);
  const [progress, setProgress] = useState(57);
  const [notify, setNotify] = useState(true);
  const [loading, setLoading] = useState(false);
  const [handle, setHandle] = useState('');
  const handleInvalid = handle.length > 0 && !/^[a-z0-9_-]{3,24}$/i.test(handle);
  const failures = CONTRAST_PAIRS.filter((p) => contrastRatio(p.fg, p.bg) < p.min).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-14 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Badge variant="warning">Development only · returns 404 in production</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">Design system</h1>
          <p className="text-muted-foreground">Every component, token and motion preset. Values on this page are samples.</p>
        </div>
        <MotionToggle />
      </header>

      <nav aria-label="Sections" className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a key={s} href={`#${s}`} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground capitalize hover:text-foreground">
            {s}
          </a>
        ))}
      </nav>

      <Section id="colors" title="Color palette" description="Deep charcoal surfaces, electric green for success and primary actions, cobalt for accents and links.">
        <div className="grid gap-6">
          {Object.entries(palette).map(([group, shades]) => (
            <div key={group} className="space-y-2">
              <h3 className="text-sm font-medium capitalize">{group}</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-10">
                {Object.entries(shades).map(([shade, hex]) => (
                  <div key={shade} className="overflow-hidden rounded-lg border border-border">
                    <div className="h-12" style={{ backgroundColor: hex }} />
                    <div className="space-y-0.5 bg-card px-2 py-1.5 text-[11px]">
                      <div className="font-medium">{shade}</div>
                      <div className="font-mono text-muted-foreground">{hex}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Semantic roles</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {Object.entries(semantic).map(([name, hex]) => (
                <div key={name} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-[11px]">
                  <span className="size-6 shrink-0 rounded-md ring-1 ring-border" style={{ backgroundColor: hex }} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{name}</span>
                    <span className="font-mono text-muted-foreground">{hex}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section id="contrast" title="Contrast check" description="WCAG 2.2: 4.5:1 for text, 3:1 for UI boundaries. The same pairs are enforced by tokens.test.ts in CI.">
        <Card className="py-0">
          <div className="flex items-center justify-between border-b border-border px-5 py-3 text-sm">
            <span>{CONTRAST_PAIRS.length} pairs checked</span>
            <Badge variant={failures === 0 ? 'success' : 'danger'}>{failures === 0 ? 'All pass' : `${failures} failing`}</Badge>
          </div>
          <div className="divide-y divide-border">
            {CONTRAST_PAIRS.map((p) => {
              const ratio = contrastRatio(p.fg, p.bg);
              const pass = ratio >= p.min;
              return (
                <div key={`${p.use}-${p.fg}-${p.bg}`} className="flex items-center gap-4 px-5 py-2.5 text-sm">
                  <span className="flex h-8 w-16 shrink-0 items-center justify-center rounded-md text-xs font-semibold" style={{ color: p.fg, backgroundColor: p.bg, border: `1px solid ${p.fg}` }}>
                    Aa
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.use}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">min {p.min}</span>
                  <span className="w-14 text-right font-mono tabular-nums">{ratio.toFixed(2)}</span>
                  <Badge variant={pass ? 'success' : 'danger'} className="w-12 justify-center">
                    {pass ? 'Pass' : 'Fail'}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </Section>

      <Section id="type" title="Typography" description="Geist for interface text, Geist Mono for addresses, hashes and amounts. Numbers use tabular figures.">
        <Card>
          <CardContent className="space-y-4">
            <p className="text-4xl font-semibold tracking-tight sm:text-5xl">Put your money where your commits are.</p>
            <p className="text-2xl font-semibold tracking-tight">Section heading 24</p>
            <p className="text-lg font-medium">Card title 18</p>
            <p className="max-w-2xl text-muted-foreground">Body 16. Daily coding activity is checked through GitHub and LeetCode evidence, and settled on Solana.</p>
            <p className="text-sm text-muted-foreground">Small 14 for supporting text.</p>
            <p className="font-mono text-sm">A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J</p>
            <p className="text-3xl font-semibold tabular-nums">
              <TokenAmount units={1_234_560_000n} token="USDC" />
            </p>
          </CardContent>
        </Card>
      </Section>

      <Section id="buttons" title="Buttons">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Join challenge</Button>
            <Button variant="accent">Sponsor pool</Button>
            <Button variant="secondary">View rules</Button>
            <Button variant="outline">Invite friends</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="destructive">Leave group</Button>
            <Button variant="link">Read the payout formula</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Wallet">
              <WalletIcon />
            </Button>
            <Button disabled>Disabled</Button>
            <Button
              loading={loading}
              onClick={() => {
                setLoading(true);
                window.setTimeout(() => setLoading(false), 1500);
              }}
            >
              {loading ? 'Confirming…' : 'Loading state (click)'}
            </Button>
            <Button asChild variant="outline">
              <a href="#buttons">Link styled as a button</a>
            </Button>
          </div>
        </div>
      </Section>

      <Section id="badges" title="Badges and status">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="primary">Surviving</Badge>
          <Badge variant="accent">Sponsored</Badge>
          <Badge variant="success">Verified</Badge>
          <Badge variant="warning">Indeterminate</Badge>
          <Badge variant="danger">Failed</Badge>
          <Badge variant="outline">Demo data</Badge>
          <Separator orientation="vertical" className="mx-2 h-6" />
          <div className="flex -space-x-2">
            {['AK', 'CH', 'MR', 'SZ'].map((i) => (
              <Avatar key={i} className="ring-2 ring-background">
                <AvatarFallback>{i}</AvatarFallback>
              </Avatar>
            ))}
          </div>
        </div>
      </Section>

      <Section id="cards" title="Cards and stats">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Current streak" value={<><AnimatedNumber key={`s-${replay}`} value={12} /> days</>} hint="Best: 21 days" icon={<FlameIcon />} tone="primary" />
          <Stat label="Pool" value={<TokenAmount units={340_000_000n} token="USDC" />} hint="20 participants" icon={<TrophyIcon />} />
          <Stat label="Survivors" value={<AnimatedNumber key={`v-${replay}`} value={14} />} hint="of 20 still in" icon={<UsersIcon />} tone="accent" />
          <Stat label="Time left today (UTC)" value="03:12:44" hint="Resets 05:30 IST" icon={<TimerIcon />} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>14-Day Developer Discipline</CardTitle>
            <CardDescription>GitHub · 15 meaningful lines per day · 20 USDC buy-in</CardDescription>
            <CardAction>
              <Badge variant="outline">Demo data</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Day 8 of 14</span>
              <span className="tabular-nums">57%</span>
            </div>
            <Progress value={57} aria-label="Challenge progress" />
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="secondary" size="sm">
              View rules
            </Button>
            <Button size="sm">Join · 20 USDC</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section id="forms" title="Forms">
        <Card>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sg-handle">LeetCode handle</Label>
              <Input id="sg-handle" placeholder="e.g. chirag126" value={handle} onChange={(e) => setHandle(e.target.value)} aria-invalid={handleInvalid || undefined} aria-describedby="sg-handle-hint" />
              <p id="sg-handle-hint" className={handleInvalid ? 'text-xs text-destructive-text' : 'text-xs text-muted-foreground'}>
                {handleInvalid ? '3–24 letters, numbers, _ or -' : 'Type "x!" to see the invalid state.'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sg-disabled">Wallet address</Label>
              <Input id="sg-disabled" disabled value="Connect a wallet first" readOnly />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="sg-notify" checked={notify} onCheckedChange={setNotify} />
              <Label htmlFor="sg-notify">Deadline warnings 3 hours before a day ends</Label>
            </div>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Warnings are <span className="font-medium text-foreground">{notify ? 'on' : 'off'}</span>.
            </p>
          </CardContent>
        </Card>
      </Section>

      <Section id="overlays" title="Tabs, tooltip and dialog">
        <Card>
          <CardContent className="space-y-6">
            <Tabs defaultValue="global">
              <TabsList>
                <TabsTrigger value="global">Global</TabsTrigger>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
                <TabsTrigger value="group">My group</TabsTrigger>
              </TabsList>
              <TabsContent value="global" className="text-sm text-muted-foreground">Global leaderboard content.</TabsContent>
              <TabsContent value="weekly" className="text-sm text-muted-foreground">Weekly leaderboard content.</TabsContent>
              <TabsContent value="group" className="text-sm text-muted-foreground">Private group leaderboard content.</TabsContent>
            </Tabs>
            <div className="flex flex-wrap items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm">
                    <InfoIcon /> What is a Shield?
                  </Button>
                </TooltipTrigger>
                <TooltipContent>A one-time protection for one missed day, bought before that day&apos;s deadline.</TooltipContent>
              </Tooltip>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="accent" size="sm">
                    Open dialog
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Sponsor this challenge</DialogTitle>
                    <DialogDescription>Sponsorship increases the reward pool for everyone who keeps their streak.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label htmlFor="sg-amount">Amount (USDC)</Label>
                    <Input id="sg-amount" inputMode="decimal" placeholder="50.00" />
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="ghost">Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="accent">Close sample</Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section id="feedback" title="Progress and loading">
        <Card>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Survival rate</span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <Progress value={progress} aria-label="Survival rate sample" />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setProgress((p) => Math.max(0, p - 10))}>
                  −10
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
                  +10
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3" aria-label="Loading placeholders">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section id="motion" title="Motion" description="Presets from src/lib/motion.ts. With reduced motion, content still fades but nothing slides or scales, counters jump to the final value, and CSS animations stop.">
        <Card>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-center gap-4">
              <MotionToggle />
              <Badge variant={reduce ? 'warning' : 'success'}>
                {reduce ? 'Motion reduced' : 'Motion on'} · preference: {preference}
              </Badge>
              <Button size="sm" variant="secondary" onClick={() => setReplay((r) => r + 1)}>
                Replay animations
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setCount((c) => c + 250)}>
                Count +250
              </Button>
            </div>
            <div className="text-4xl font-semibold tracking-tight">
              <AnimatedNumber value={count} /> <span className="text-base text-muted-foreground">developers</span>
            </div>
            <Stagger key={`stagger-${replay}-${String(reduce)}`} className="grid gap-3 sm:grid-cols-4">
              {['Join', 'Code daily', 'Get verified', 'Claim'].map((step, i) => (
                <StaggerItem key={step}>
                  <div className="rounded-lg border border-border bg-muted p-4 text-sm">
                    <div className="text-xs text-muted-foreground">Step {i + 1}</div>
                    <div className="font-medium">{step}</div>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
            <div className="grid gap-3 sm:grid-cols-3">
              {(['fadeIn', 'fadeUp', 'scaleIn'] as const).map((v) => (
                <Reveal key={`${v}-${replay}-${String(reduce)}`} variant={v} trigger="mount">
                  <div className="rounded-lg border border-border bg-card p-4 font-mono text-sm">{v}</div>
                </Reveal>
              ))}
            </div>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
