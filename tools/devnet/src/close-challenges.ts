// Cancels every CodeStreak challenge the program allows to be cancelled, then refunds everyone.
//   pnpm devnet:close-challenges            (do it)
//   pnpm devnet:close-challenges --dry-run  (only report)
//
// The program allows cancelling only:
//   - by the creator, before the start (here: challenges the relayer created, e.g. demo seeds);
//   - by anyone, once joining has closed with fewer than the minimum players.
// A challenge that started with enough players cannot be cancelled: it must finish and settle.
// Refunds are permissionless and always paid to each participant's / sponsor's own token account.
import { associatedTokenAddress, challengePhase, challengeTimes, enumVariant, explorerTxUrl } from '@codestreak/shared/program';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, type Connection, type Keypair } from '@solana/web3.js';

import { connectDevnet, loadKeypair, main, programFor } from './common.js';

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const dryRun = process.argv.includes('--dry-run');

/** The owner's token account for `mint`, created (relayer pays) if missing, so a refund can land. */
async function ensureTokenAccount(connection: Connection, payer: Keypair, owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  const account = associatedTokenAddress(owner, mint, TOKEN_PROGRAM);
  if (await connection.getAccountInfo(account)) return account;
  const ix = new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
  if (!dryRun) await connection.sendTransaction(new Transaction().add(ix), [payer]).then((sig) => connection.confirmTransaction(sig, 'confirmed'));
  return account;
}

/** Marks the app's mirror cancelled (the web app also refreshes it when the page is viewed). */
async function markCancelledInDb(address: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/challenges?onchain_address=eq.${address}`, {
    method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ pool_state: 'cancelled' }),
  });
}

await main(async () => {
  const connection = await connectDevnet();
  const relayer = loadKeypair('RELAYER_KEYPAIR_PATH');
  const program = programFor(connection, relayer);
  const slot = await connection.getSlot('confirmed');
  const now = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);

  const challenges = await program.account.challenge.all();
  console.log(`${challenges.length} challenge(s) on devnet${dryRun ? ' (dry run: nothing is sent)' : ''}\n`);
  const cancelled: typeof challenges = [];

  for (const c of challenges) {
    const a = c.account;
    const address = c.publicKey.toBase58();
    const state = enumVariant<'open' | 'cancelled' | 'settled'>(a.state);
    const phase = challengePhase(challengeTimes(a), now);
    const label = `${address.slice(0, 6)}… ${a.isDemo ? 'DEMO ' : ''}${a.participantCount}/${a.minParticipants} players, ${phase}`;
    if (state === 'cancelled') {
      console.log(`already cancelled  ${label}`);
      cancelled.push(c);
      continue;
    }
    if (state === 'settled') {
      console.log(`settled            ${label}`);
      continue;
    }
    const creatorBeforeStart = a.creator.equals(relayer.publicKey) && now < a.startTs.toNumber();
    const undersubscribed = now >= a.joinDeadlineTs.toNumber() && a.participantCount < a.minParticipants;
    if (!creatorBeforeStart && !undersubscribed) {
      const why = now < a.joinDeadlineTs.toNumber() ? 'joining still open and not created by the relayer' : 'has enough players: it must finish and settle';
      console.log(`cannot cancel      ${label} (${why})`);
      continue;
    }
    if (dryRun) {
      console.log(`would cancel       ${label}`);
      continue;
    }
    const sig = await program.methods.cancelPool().accountsPartial({ authority: relayer.publicKey, challenge: c.publicKey }).rpc();
    await markCancelledInDb(address);
    console.log(`cancelled          ${label}  ${explorerTxUrl(sig)}`);
    cancelled.push(c);
  }

  // Refund everyone in cancelled challenges (stake + Shields to participants, sponsorships to sponsors).
  let refunds = 0;
  for (const c of cancelled) {
    const filter = [{ memcmp: { offset: 8, bytes: c.publicKey.toBase58() } }];
    const accounts = { challenge: c.publicKey, mint: c.account.mint, vault: c.account.vault, tokenProgram: c.account.tokenProgram };
    for (const p of await program.account.participant.all(filter)) {
      if (p.account.claimed) continue;
      const destination = await ensureTokenAccount(connection, relayer, p.account.user, c.account.mint);
      if (dryRun) {
        console.log(`would refund participant ${p.account.user.toBase58()}`);
        continue;
      }
      const sig = await program.methods.claimRefund().accountsPartial({ ...accounts, participant: p.publicKey, destination }).rpc();
      console.log(`refunded participant ${p.account.user.toBase58()}  ${explorerTxUrl(sig)}`);
      refunds++;
    }
    for (const r of await program.account.sponsorReceipt.all(filter)) {
      if (r.account.refunded) continue;
      const destination = await ensureTokenAccount(connection, relayer, r.account.sponsor, c.account.mint);
      if (dryRun) {
        console.log(`would refund sponsor ${r.account.sponsor.toBase58()}`);
        continue;
      }
      const sig = await program.methods.claimSponsorRefund().accountsPartial({ ...accounts, receipt: r.publicKey, destination }).rpc();
      console.log(`refunded sponsor ${r.account.sponsor.toBase58()}  ${explorerTxUrl(sig)}`);
      refunds++;
    }
  }
  console.log(`\nDone. ${refunds} refund(s) paid. Refunds of SOL challenges arrive as wSOL (unwrap in Phantom).`);
});
