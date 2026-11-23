import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { previewInviteLink } from '@/lib/groups/invites';
import { getViewer } from '@/lib/supabase/server';
import { RedeemButton } from './redeem-button';

export const metadata: Metadata = { title: 'Invitation', robots: { index: false, follow: false } };

// Opening this page never consumes the link; only the button does.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await previewInviteLink(token);
  const viewer = preview.ok ? await getViewer() : null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-16 sm:px-6">
      <Card>
        <CardHeader>
          <Badge variant="accent">Private group</Badge>
          <CardTitle className="text-2xl">{preview.ok ? `You're invited to “${preview.title}”` : 'Invitation unavailable'}</CardTitle>
          <CardDescription>
            {preview.ok ? 'Accept to see the group and join it with a stake. Joining is a separate step.' : preview.error}
          </CardDescription>
        </CardHeader>
        {preview.ok && (
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">Stake to join</dt><dd className="font-mono">{preview.terms.stake}</dd></div>
              <div><dt className="text-muted-foreground">Length</dt><dd>{preview.terms.days}</dd></div>
              <div><dt className="text-muted-foreground">Starts</dt><dd>{preview.terms.starts}</dd></div>
              <div><dt className="text-muted-foreground">Join by</dt><dd>{preview.terms.joinBy}</dd></div>
            </dl>
            <p className="text-sm text-muted-foreground">
              {preview.terms.goal} Miss a day and you lose your stake. You&apos;ll see every rule again, and confirm them, before you stake.
            </p>
            {viewer ? (
              <RedeemButton token={token} />
            ) : (
              <a className="text-sm underline" href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}>
                Sign in to accept
              </a>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
