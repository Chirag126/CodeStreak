// Phase 37.3, run once after the program upgrade: removes the mint and freeze authority from every
// badge minted before the upgrade, so wallets (Phantom) show it as an NFT instead of a token.
// New badges come out sealed already. Permissionless and safe to re-run: it only takes authority
// away (never moves a badge) and skips badges that are already sealed. The relayer pays the fees.
//
//   pnpm devnet:seal-badges             # seal
//   pnpm devnet:seal-badges --dry-run   # only list what would be sealed
import { badgeAuthorityPda, badgeMintPda, explorerTxUrl, TOKEN_2022_PROGRAM_ID } from '@codestreak/shared/program';

import { connectDevnet, loadKeypair, main, programFor } from './common.js';

/** Token-2022 base mint layout: mint authority COption at 0..36, freeze authority COption at 46..82. */
const hasAuthority = (data: Buffer, at: number) => data.readUInt32LE(at) === 1;

await main(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const connection = await connectDevnet();
  const relayer = loadKeypair('RELAYER_KEYPAIR_PATH');
  const program = programFor(connection, relayer);

  let sealed = 0;
  let already = 0;
  for (const p of await program.account.participant.all()) {
    const mint = badgeMintPda(p.publicKey);
    const info = await connection.getAccountInfo(mint);
    if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) continue; // no badge for this player
    if (!hasAuthority(info.data, 0) && !hasAuthority(info.data, 46)) {
      already++;
      continue;
    }
    if (dryRun) {
      console.log(`would seal ${mint.toBase58()} (player ${p.account.user.toBase58()})`);
      continue;
    }
    const sig = await program.methods
      .sealBadge()
      .accountsPartial({ participant: p.publicKey, badgeMint: mint, badgeAuthority: badgeAuthorityPda(), tokenProgram: TOKEN_2022_PROGRAM_ID })
      .rpc();
    sealed++;
    console.log(`sealed ${mint.toBase58()}  ${explorerTxUrl(sig)}`);
  }
  console.log(`\n${dryRun ? 'dry run: ' : ''}${sealed} sealed, ${already} already sealed.`);
});
