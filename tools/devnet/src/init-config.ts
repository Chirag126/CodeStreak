// One-time: creates the program's global Config on devnet (admin, default verifier, allowed mints).
// Must be signed by the program's upgrade authority. Safe to re-run: it only reports an existing config.
//
//   pnpm devnet:init-config
import {
  DEVNET_USDC_MINT,
  WSOL_MINT,
} from '@codestreak/shared';
import { PROGRAM_ID, configPda, explorerAddressUrl, explorerTxUrl, programDataAddress } from '@codestreak/shared/program';
import { PublicKey, SystemProgram } from '@solana/web3.js';

import { connectDevnet, loadKeypair, main, programFor, pubkeyEnv } from './common.js';

await main(async () => {
  const connection = await connectDevnet();
  const authority = loadKeypair('UPGRADE_AUTHORITY_KEYPAIR_PATH');
  const program = programFor(connection, authority);
  const config = configPda();

  const existing = await program.account.config.fetchNullable(config);
  if (existing) {
    console.log('Config already initialized:');
    console.log(`  admin             ${existing.admin.toBase58()}`);
    console.log(`  default verifier  ${existing.defaultVerifier.toBase58()}`);
    console.log(`  allowed mints     ${existing.allowedMints.map((m) => m.toBase58()).join(', ')}`);
    console.log(`  ${explorerAddressUrl(config)}`);
    return;
  }

  const expectedAuthority = pubkeyEnv('UPGRADE_AUTHORITY_PUBKEY');
  if (!authority.publicKey.equals(expectedAuthority)) {
    throw new Error(`UPGRADE_AUTHORITY_KEYPAIR_PATH holds ${authority.publicKey.toBase58()}, expected ${expectedAuthority.toBase58()}`);
  }
  const admin = pubkeyEnv('ADMIN_PUBKEY');
  const verifier = pubkeyEnv('VERIFIER_PUBKEY');
  const mints = [new PublicKey(DEVNET_USDC_MINT), new PublicKey(WSOL_MINT)];

  const signature = await program.methods
    .initializeConfig(admin, verifier, mints)
    .accountsPartial({
      authority: authority.publicKey,
      config,
      program: PROGRAM_ID,
      programData: programDataAddress(),
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log('Config initialized.');
  console.log(`  admin             ${admin.toBase58()}`);
  console.log(`  default verifier  ${verifier.toBase58()}`);
  console.log(`  allowed mints     USDC ${DEVNET_USDC_MINT}, wSOL ${WSOL_MINT}`);
  console.log(`  tx      ${explorerTxUrl(signature)}`);
  console.log(`  config  ${explorerAddressUrl(config)}`);
});
