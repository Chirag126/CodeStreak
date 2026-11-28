// The worker's view of the chain: reads (challenge, participants, sponsor receipts) and the
// transactions it sends with the verifier key. Calls are single attempts: retries live in run.ts,
// which re-checks the chain before every attempt, so a retry after a lost confirmation never
// produces a second transaction for the same thing.
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  badgeAuthorityPda,
  badgeMintPda,
  badgeTokenAccount,
  challengeMirrorRow,
  challengeTimes,
  Connection,
  createProgram,
  enumVariant,
  Keypair,
  keypairWallet,
  PublicKey,
  SystemProgram,
  TOKEN_2022_PROGRAM_ID,
  Transaction,
  TransactionInstruction,
  type ChallengeAccount,
  type ChallengeMirrorRow,
  type ChallengeTimes,
  type CodestreakProgram,
  type ParticipantAccount,
} from '@codestreak/shared/program';
import { computeBudgetInstructions, planComputeBudget, sendWithResend } from '@codestreak/shared/relayer';

export type DayResultName = 'verified' | 'failed' | 'indeterminate';
export type ParticipantStatusName = 'active' | 'survived' | 'failed' | 'voided';

export interface ChainChallenge {
  address: string;
  times: ChallengeTimes;
  participantCount: number;
  minParticipants: number;
  mint: string;
  vault: string;
  tokenProgram: string;
  verifier: string;
  /** 64 hex */
  rulesHash: string;
  survivorCount: number;
  /** Settlement (zero until settled). */
  fullRefund: boolean;
  rewardPerSurvivor: bigint;
  rewardDust: bigint;
  survivorsClaimed: number;
  /** The creator's wallet, and the database's copy of this account (Phase 29 reconciliation). */
  creator: string;
  mirror: ChallengeMirrorRow;
}

export interface ChainParticipant {
  address: string;
  user: string;
  deposited: bigint;
  shieldPaid: bigint;
  verifiedDays: bigint;
  failedDays: bigint;
  indeterminateDays: bigint;
  shieldedDays: bigint;
  finalized: boolean;
  claimed: boolean;
  status: ParticipantStatusName;
  joinedAt: number;
}

/** A participant's soulbound badge mint (Phase 34): its PDA address, and whether it exists yet. */
export interface ChainBadge {
  mint: string;
  minted: boolean;
  /** The transaction that created it (the oldest on the address), once minted. */
  tx: string | null;
}

export interface ChainSponsorReceipt {
  address: string;
  sponsor: string;
  amount: bigint;
  refunded: boolean;
}

export interface Chain {
  verifier: string;
  /** The chain's clock (unix seconds): every timing decision uses it, not the server's. */
  now(): Promise<number>;
  challenge(address: string): Promise<ChainChallenge | null>;
  /** Every challenge of the program. */
  allChallenges(): Promise<ChainChallenge[]>;
  participants(challenge: string): Promise<ChainParticipant[]>;
  participant(address: string): Promise<ChainParticipant | null>;
  sponsorReceipts(challenge: string): Promise<ChainSponsorReceipt[]>;
  sponsorReceipt(address: string): Promise<ChainSponsorReceipt | null>;
  recordVerification(challenge: string, participant: string, day: number, result: DayResultName, evidenceHashHex: string): Promise<string>;
  cancel(challenge: string): Promise<string>;
  finalize(challenge: string, participant: string): Promise<string>;
  settle(challenge: string): Promise<string>;
  /** Pays a participant's reward/refund into the token account of their own wallet. */
  claimParticipant(c: ChainChallenge, p: ChainParticipant, kind: 'reward' | 'refund'): Promise<string>;
  claimSponsorRefund(c: ChainChallenge, r: ChainSponsorReceipt): Promise<string>;
  badge(participant: string): Promise<ChainBadge>;
  /** Mints a Survived participant's badge into their own wallet (the verifier pays the rent). */
  mintBadge(c: ChainChallenge, p: ChainParticipant): Promise<string>;
}

export function dayResultOf(p: Pick<ChainParticipant, 'verifiedDays' | 'failedDays' | 'indeterminateDays'>, day: number): DayResultName | null {
  const bit = 1n << BigInt(day);
  if (p.verifiedDays & bit) return 'verified';
  if (p.failedDays & bit) return 'failed';
  if (p.indeterminateDays & bit) return 'indeterminate';
  return null;
}

/** Loads the verifier keypair from VERIFIER_KEYPAIR_JSON (a 64-number JSON array, as solana-keygen writes). */
export function loadVerifier(json: string | undefined, expectedPubkey?: string): Keypair | null {
  if (!json) return null;
  let bytes: unknown;
  try {
    bytes = JSON.parse(json);
  } catch {
    throw new Error('VERIFIER_KEYPAIR_JSON is not valid JSON (paste the whole [n, n, …] array from the keypair file)');
  }
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new Error('VERIFIER_KEYPAIR_JSON must be a JSON array of 64 numbers (0-255)');
  }
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  } catch {
    throw new Error('VERIFIER_KEYPAIR_JSON is not a valid keypair (its last 32 numbers must be the public key of the first 32)');
  }
  if (expectedPubkey && keypair.publicKey.toBase58() !== expectedPubkey) {
    throw new Error(`VERIFIER_KEYPAIR_JSON is the key of ${keypair.publicKey.toBase58()}, not VERIFIER_PUBKEY ${expectedPubkey}`);
  }
  return keypair;
}

const big = (v: { toString(): string }) => BigInt(v.toString());

function participantOf(address: string, a: ParticipantAccount): ChainParticipant {
  return {
    address,
    user: a.user.toBase58(),
    deposited: big(a.deposited),
    shieldPaid: big(a.shieldPaid),
    verifiedDays: big(a.verifiedDays),
    failedDays: big(a.failedDays),
    indeterminateDays: big(a.indeterminateDays),
    shieldedDays: big(a.shieldedDays),
    finalized: a.finalized,
    claimed: a.claimed,
    status: enumVariant<ParticipantStatusName>(a.status),
    joinedAt: a.joinedAt.toNumber(),
  };
}

function challengeOf(address: string, a: ChallengeAccount): ChainChallenge {
  return {
    address,
    times: challengeTimes(a),
    participantCount: a.participantCount,
    minParticipants: a.minParticipants,
    mint: a.mint.toBase58(),
    vault: a.vault.toBase58(),
    tokenProgram: a.tokenProgram.toBase58(),
    verifier: a.verifier.toBase58(),
    rulesHash: Buffer.from(a.rulesHash).toString('hex'),
    survivorCount: a.survivorCount,
    fullRefund: a.fullRefund,
    rewardPerSurvivor: big(a.rewardPerSurvivor),
    rewardDust: big(a.rewardDust),
    survivorsClaimed: a.survivorsClaimed,
    creator: a.creator.toBase58(),
    mirror: challengeMirrorRow(address, a),
  };
}

/** No verifier key: reads work, every send explains what is missing. */
const NO_KEY = () => Promise.reject(new Error('VERIFIER_KEYPAIR_JSON is not set on the worker, so it cannot send transactions'));

export function createSolanaChain(rpcUrl: string, verifier: Keypair | null): Chain {
  const connection = new Connection(rpcUrl, 'confirmed');
  const reader = createSolanaReader(connection);
  if (!verifier) return reader;
  const signer: Keypair = verifier;
  const program: CodestreakProgram = createProgram(connection, keypairWallet(signer));
  const key = (s: string) => new PublicKey(s);

  /**
   * Phase 42: every worker transaction gets a compute limit from a simulation (what it really uses,
   * plus a margin), the going priority fee, a fresh blockhash, and is re-sent until it is confirmed
   * or its blockhash expires (then run.ts re-checks the chain and tries again).
   */
  async function send(instructions: TransactionInstruction[], cap = 200_000): Promise<string> {
    const plan = await planComputeBudget(connection, { payer: signer.publicKey, instructions, cap });
    if (plan.err) throw Object.assign(new Error(`Simulation failed: ${JSON.stringify(plan.err)}`), { logs: plan.logs ?? undefined });
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...computeBudgetInstructions(plan.units, plan.microLamports), ...instructions);
    tx.sign(signer);
    return sendWithResend(connection, tx.serialize(), { lastValidBlockHeight });
  }

  /** The owner's associated token account for the challenge's mint, created (rent paid by the verifier) if missing. */
  async function ensureTokenAccount(c: ChainChallenge, owner: string): Promise<PublicKey> {
    const account = associatedTokenAddress(key(owner), key(c.mint), key(c.tokenProgram));
    if (await connection.getAccountInfo(account)) return account;
    const ix = new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: account, isSigner: false, isWritable: true },
        { pubkey: key(owner), isSigner: false, isWritable: false },
        { pubkey: key(c.mint), isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: key(c.tokenProgram), isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // CreateIdempotent: safe to repeat
    });
    await send([ix], 60_000);
    return account;
  }

  return {
    ...reader,
    verifier: signer.publicKey.toBase58(),
    recordVerification: (challenge, participant, day, result, hashHex) =>
      program.methods
        .recordVerification(day, { [result]: {} } as never, Array.from(Buffer.from(hashHex, 'hex')))
        .accountsPartial({ verifier: signer.publicKey, challenge: key(challenge), participant: key(participant) })
        .instruction()
        .then((ix) => send([ix])),
    cancel: async (challenge) => send([await program.methods.cancelPool().accountsPartial({ authority: signer.publicKey, challenge: key(challenge) }).instruction()]),
    finalize: (challenge, participant) =>
      program.methods.finalizeParticipant().accountsPartial({ challenge: key(challenge), participant: key(participant) }).instruction().then((ix) => send([ix])),
    settle: async (challenge) => send([await program.methods.settleChallenge().accountsPartial({ challenge: key(challenge) }).instruction()]),
    claimParticipant: async (c, p, kind) => {
      const destination = await ensureTokenAccount(c, p.user);
      const accounts = { challenge: key(c.address), participant: key(p.address), mint: key(c.mint), destination, vault: key(c.vault), tokenProgram: key(c.tokenProgram) };
      return send([await (kind === 'reward' ? program.methods.claimReward() : program.methods.claimRefund()).accountsPartial(accounts).instruction()]);
    },
    claimSponsorRefund: async (c, r) => {
      const destination = await ensureTokenAccount(c, r.sponsor);
      const ix = await program.methods
        .claimSponsorRefund()
        .accountsPartial({ challenge: key(c.address), receipt: key(r.address), mint: key(c.mint), destination, vault: key(c.vault), tokenProgram: key(c.tokenProgram) })
        .instruction();
      return send([ix]);
    },
    mintBadge: async (c, p) => {
      const participant = key(p.address);
      const ix = await program.methods
        .mintBadge()
        .accountsPartial({
          payer: signer.publicKey,
          challenge: key(c.address),
          participant,
          user: key(p.user),
          badgeMint: badgeMintPda(participant),
          badgeAuthority: badgeAuthorityPda(),
          userBadgeAccount: badgeTokenAccount(key(p.user), participant),
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      // Several CPIs (allocate, extensions, metadata, ATA): up to 400k units; the simulation sets the real limit.
      return send([ix], 400_000);
    },
  };
}

/** The read half of the chain (no key needed): used for reconciliation and by createSolanaChain. */
function createSolanaReader(connection: Connection): Chain {
  const program: CodestreakProgram = createProgram(connection);
  const key = (s: string) => new PublicKey(s);
  return {
    verifier: '',
    now: async () => {
      const slot = await connection.getSlot('confirmed');
      return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
    },
    challenge: async (address) => {
      const a = await program.account.challenge.fetchNullable(key(address));
      return a ? challengeOf(address, a) : null;
    },
    allChallenges: async () => (await program.account.challenge.all()).map((a) => challengeOf(a.publicKey.toBase58(), a.account)),
    participants: async (challenge) =>
      (await program.account.participant.all([{ memcmp: { offset: 8, bytes: challenge } }])).map((p) => participantOf(p.publicKey.toBase58(), p.account)),
    participant: async (address) => {
      const a = await program.account.participant.fetchNullable(key(address));
      return a ? participantOf(address, a) : null;
    },
    sponsorReceipts: async (challenge) =>
      (await program.account.sponsorReceipt.all([{ memcmp: { offset: 8, bytes: challenge } }])).map((r) => ({
        address: r.publicKey.toBase58(),
        sponsor: r.account.sponsor.toBase58(),
        amount: big(r.account.amount),
        refunded: r.account.refunded,
      })),
    sponsorReceipt: async (address) => {
      const a = await program.account.sponsorReceipt.fetchNullable(key(address));
      return a ? { address, sponsor: a.sponsor.toBase58(), amount: big(a.amount), refunded: a.refunded } : null;
    },
    badge: async (participant) => {
      const mint = badgeMintPda(key(participant));
      const info = await connection.getAccountInfo(mint);
      // Minted = a Token-2022 account; lamports alone (someone sent SOL there) is not a badge.
      const minted = !!info && info.owner.equals(TOKEN_2022_PROGRAM_ID) && info.data.length > 0;
      let tx: string | null = null;
      if (minted) {
        const sigs = await connection.getSignaturesForAddress(mint, { limit: 50 });
        tx = sigs.filter((s) => !s.err).at(-1)?.signature ?? null;
      }
      return { mint: mint.toBase58(), minted, tx };
    },
    recordVerification: NO_KEY,
    mintBadge: NO_KEY,
    cancel: NO_KEY,
    finalize: NO_KEY,
    settle: NO_KEY,
    claimParticipant: NO_KEY,
    claimSponsorRefund: NO_KEY,
  };
}
