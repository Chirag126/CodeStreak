// Creates a clearly labeled DEMO challenge on devnet (compressed time: 5-minute "days"), then reads
// it back from the chain. The relayer key pays and acts as the demo creator; no tokens are needed.
//
//   pnpm devnet:seed-demo                          (joining open ~14 minutes)
//   pnpm devnet:seed-demo --start-in-minutes=180   (joining open ~3 hours, for testing joins)
//   pnpm devnet:seed-demo --token=sol              (SOL stake: 0.05 SOL buy-in, wrapped on join)
import { DEVNET_USDC_MINT, SOL_DECIMALS, USDC_DECIMALS, WSOL_MINT } from '@codestreak/shared';
import {
  anchor,
  challengePda,
  configPda,
  disputeEndTs,
  endTs,
  explorerAddressUrl,
  explorerTxUrl,
  fetchChallenge,
  rulesHash,
  vaultPda,
  verifyEndTs,
  type InitializePoolParams,
} from '@codestreak/shared/program';
import { PublicKey, SystemProgram } from '@solana/web3.js';

import { connectDevnet, loadKeypair, main, programFor } from './common.js';

const isSol = process.argv.includes('--token=sol');
const DECIMALS = isSol ? SOL_DECIMALS : USDC_DECIMALS;
const SYMBOL = isSol ? 'SOL' : 'USDC';
const units = (amount: number) => new anchor.BN(Math.round(amount * 10 ** DECIMALS));
const iso = (ts: number) => new Date(ts * 1000).toISOString();

await main(async () => {
  const connection = await connectDevnet();
  const relayer = loadKeypair('RELAYER_KEYPAIR_PATH');
  const program = programFor(connection, relayer);

  if (!(await program.account.config.fetchNullable(configPda()))) {
    throw new Error('Program config is not initialized: run `pnpm devnet:init-config` first.');
  }

  // The rules every participant agrees to. Stored off-chain (Supabase, later phases); its hash is on-chain.
  const rules = {
    version: 1,
    label: 'DEMO - compressed time: each "day" lasts 5 minutes. Devnet test tokens only, no real value.',
    providers: ['github', 'leetcode'],
    github: { minMeaningfulLines: 15, ownNonForkReposOnly: true },
    leetcode: { minAcceptedPerDay: 1 },
  };
  const hash = await rulesHash(rules);

  const now = Math.floor(Date.now() / 1000);
  const arg = process.argv.find((a) => a.startsWith('--start-in-minutes='));
  const startInMinutes = arg ? Number(arg.split('=')[1]) : 15;
  if (!Number.isInteger(startInMinutes) || startInMinutes < 5 || startInMinutes > 7 * 24 * 60) {
    throw new Error('--start-in-minutes must be a whole number between 5 and 10080');
  }
  const start = now + startInMinutes * 60; // joining closes one minute before the start
  const challengeId = BigInt(Date.now());
  const params: InitializePoolParams = {
    challengeId: new anchor.BN(challengeId.toString()),
    buyIn: units(isSol ? 0.05 : 1),
    startTs: new anchor.BN(start),
    dayLengthSecs: 300,
    numDays: 3,
    joinDeadlineTs: new anchor.BN(start - 60),
    minParticipants: 2,
    maxParticipants: 50,
    shieldPrice: units(isSol ? 0.01 : 0.5),
    maxShieldsPerParticipant: 1,
    shieldGraceSecs: 120,
    verifyWindowSecs: 600,
    disputeWindowSecs: 900,
    joinAuthority: null,
    rulesHash: hash,
  };

  const challenge = challengePda(relayer.publicKey, challengeId);
  const vault = vaultPda(challenge);
  const signature = await program.methods
    .initializePool(params)
    .accountsPartial({
      payer: relayer.publicKey,
      creator: relayer.publicKey,
      config: configPda(),
      challenge,
      mint: new PublicKey(isSol ? WSOL_MINT : DEVNET_USDC_MINT),
      vault,
      tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`Created demo challenge ${challenge.toBase58()}`);
  console.log(`  tx ${explorerTxUrl(signature)}`);

  // Read it back from the chain.
  const { account: c, times, phase, chainTime } = await fetchChallenge(program, challenge);
  const vaultBalance = await connection.getTokenAccountBalance(vault);
  console.log('\nRead back from devnet:');
  console.log(`  label           ${c.isDemo ? 'DEMO (compressed time)' : 'real time'}`);
  console.log(`  challenge id    ${c.challengeId.toString()}`);
  console.log(`  creator         ${c.creator.toBase58()}`);
  console.log(`  mint            ${c.mint.toBase58()} (${isSol ? 'wrapped SOL' : 'devnet USDC'})`);
  console.log(`  buy-in          ${Number(c.buyIn.toString()) / 10 ** DECIMALS} ${SYMBOL}`);
  console.log(`  days            ${c.numDays} x ${c.dayLengthSecs}s`);
  console.log(`  join until      ${iso(times.joinDeadlineTs)}`);
  console.log(`  start / end     ${iso(times.startTs)} / ${iso(endTs(times))}`);
  console.log(`  verify / settle ${iso(verifyEndTs(times))} / ${iso(disputeEndTs(times))}`);
  console.log(`  verifier        ${c.verifier.toBase58()}`);
  console.log(`  rules hash      ${Buffer.from(c.rulesHash).toString('hex')}`);
  console.log(`  phase now       ${phase} (chain time ${iso(chainTime)})`);
  console.log(`  participants    ${c.participantCount}/${c.maxParticipants}`);
  console.log(`  vault           ${vault.toBase58()} balance ${vaultBalance.value.uiAmountString} ${SYMBOL}`);
  if (!c.isDemo || !Buffer.from(c.rulesHash).equals(Buffer.from(hash))) throw new Error('read-back mismatch');
  console.log(`\n  ${explorerAddressUrl(challenge)}`);
  console.log(`  App page: ${process.env.APP_URL ?? 'http://localhost:3000'}/challenges/${challenge.toBase58()}`);
});
