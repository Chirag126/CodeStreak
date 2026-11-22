import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SIGN_IN_PATH } from '@/lib/auth/routes';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';
import { CreateWizard } from './create-wizard';

export const metadata: Metadata = { title: 'Create a challenge' };

export default async function NewChallengePage() {
  const viewer = await getViewer();
  if (!viewer) redirect(`${SIGN_IN_PATH}?next=/challenges/new`);
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('wallets').select('address').not('verified_at', 'is', null);
  const linkedWallets = (data ?? []).map((w) => w.address as string);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="space-y-1">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Create a challenge</h1>
        <p className="text-sm text-muted-foreground">Set the stakes and the rules. The pool and its vault are created on Solana devnet, owned by the program.</p>
      </div>
      <CreateWizard linkedWallets={linkedWallets} />
    </div>
  );
}
