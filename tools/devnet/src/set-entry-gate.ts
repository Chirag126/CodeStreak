// Phase 37.2: turns on the program's entry gate. From then on, creating, joining and sponsoring a
// challenge only work when the CodeStreak relayer pays for (and so approves) the transaction, so the
// server's account checks (moderation) can't be skipped by sending a transaction directly.
// Claims, refunds, finalizing, settling and Shields are never affected.
//
//   pnpm devnet:set-entry-gate            # gate = RELAYER_PUBKEY
//   pnpm devnet:set-entry-gate --off      # open again (emergency only)
//
// Signed by the config admin: ADMIN_KEYPAIR_PATH (the admin.json from generate-keys.sh). Safe to re-run.
import { configPda, entryGatePda, explorerTxUrl } from '@codestreak/shared/program';
import { SystemProgram } from '@solana/web3.js';

import { connectDevnet, loadKeypair, main, programFor, pubkeyEnv } from './common.js';

await main(async () => {
  const off = process.argv.includes('--off');
  const connection = await connectDevnet();
  const admin = loadKeypair('ADMIN_KEYPAIR_PATH');
  const program = programFor(connection, admin);

  const config = await program.account.config.fetchNullable(configPda());
  if (!config) throw new Error('Program config is not initialized: run `pnpm devnet:init-config` first.');
  if (!config.admin.equals(admin.publicKey)) {
    throw new Error(`ADMIN_KEYPAIR_PATH holds ${admin.publicKey.toBase58()}, but the config admin is ${config.admin.toBase58()}`);
  }
  const authority = off ? null : pubkeyEnv('RELAYER_PUBKEY');

  const current = await program.account.entryGate.fetchNullable(entryGatePda());
  const now = current?.authority?.toBase58() ?? null;
  if (current && now === (authority?.toBase58() ?? null)) {
    console.log(`Entry gate already ${now ? `set to ${now}` : 'open'}. Nothing to do.`);
    return;
  }

  const signature = await program.methods
    .setEntryGate(authority)
    .accountsPartial({ admin: admin.publicKey, config: configPda(), entryGate: entryGatePda(), systemProgram: SystemProgram.programId })
    .rpc();
  console.log(authority ? `Entry gate set: new challenges, joins and sponsorships need ${authority.toBase58()} (the relayer).` : 'Entry gate opened.');
  console.log(`  tx ${explorerTxUrl(signature)}`);
});
