// The worker's view of the chain: reads (challenge, participants, sponsor receipts) and the
// transactions it sends with the verifier key. Calls are single attempts: retries live in run.ts,
// which re-checks the chain before every attempt, so a retry after a lost confirmation never
// produces a second transaction for the same thing.
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  challengeTimes,
  ComputeBudgetProgram,
  Connection,
  createProgram,
  enumVariant,
  Keypair,
  keypairWallet,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type ChallengeTimes,
  type CodestreakProgram,
  type ParticipantAccount,
} from '@codestreak/shared/program';

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
}

export interface ChainParticipant {
  address: string;
  user: string;
  deposited: bigint;
  shieldPaid: bigint;
  verifiedDays: bigint;
  failedDays: bigint;
  indeterminateDays: bigint;
  finalized: boolean;
  claimed: boolean;
  status: ParticipantStatusName;
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
    finalized: a.finalized,
    claimed: a.claimed,
    status: enumVariant<ParticipantStatusName>(a.status),
  };
}

export function createSolanaChain(rpcUrl: string, verifier: Keypair): Chain {
  const connection = new Connection(rpcUrl, 'confirmed');
  const program: CodestreakProgram = createProgram(connection, keypairWallet(verifier));
  const key = (s: string) => new PublicKey(s);
  const priority = [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 })];

  /** The owner's associated token account for the challenge's mint, created (rent paid by the verifier) if missing. */
  async function ensureTokenAccount(c: ChainChallenge, owner: string): Promise<PublicKey> {
    const account = associatedTokenAddress(key(owner), key(c.mint), key(c.tokenProgram));
    if (await connection.getAccountInfo(account)) return account;
    const ix = new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: verifier.publicKey, isSigner: true, isWritable: true },
        { pubkey: account, isSigner: false, isWritable: true },
        { pubkey: key(owner), isSigner: false, isWritable: false },
        { pubkey: key(c.mint), isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: key(c.tokenProgram), isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // CreateIdempotent: safe to repeat
    });
    const sig = await connection.sendTransaction(new Transaction().add(ix), [verifier]);
    await connection.confirmTransaction(sig, 'confirmed');
    return account;
  }

  return {
    verifier: verifier.publicKey.toBase58(),
    now: async () => {
      const slot = await connection.getSlot('confirmed');
      return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
    },
    challenge: async (address) => {
      const a = await program.account.challenge.fetchNullable(key(address));
      if (!a) return null;
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
      };
    },
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
    recordVerification: (challenge, participant, day, result, hashHex) =>
      program.methods
        .recordVerification(day, { [result]: {} } as never, Array.from(Buffer.from(hashHex, 'hex')))
        .accountsPartial({ verifier: verifier.publicKey, challenge: key(challenge), participant: key(participant) })
        .preInstructions(priority)
        .rpc(),
    cancel: (challenge) => program.methods.cancelPool().accountsPartial({ authority: verifier.publicKey, challenge: key(challenge) }).preInstructions(priority).rpc(),
    finalize: (challenge, participant) =>
      program.methods.finalizeParticipant().accountsPartial({ challenge: key(challenge), participant: key(participant) }).preInstructions(priority).rpc(),
    settle: (challenge) => program.methods.settleChallenge().accountsPartial({ challenge: key(challenge) }).preInstructions(priority).rpc(),
    claimParticipant: async (c, p, kind) => {
      const destination = await ensureTokenAccount(c, p.user);
      const accounts = { challenge: key(c.address), participant: key(p.address), mint: key(c.mint), destination, vault: key(c.vault), tokenProgram: key(c.tokenProgram) };
      return (kind === 'reward' ? program.methods.claimReward() : program.methods.claimRefund()).accountsPartial(accounts).preInstructions(priority).rpc();
    },
    claimSponsorRefund: async (c, r) => {
      const destination = await ensureTokenAccount(c, r.sponsor);
      return program.methods
        .claimSponsorRefund()
        .accountsPartial({ challenge: key(c.address), receipt: key(r.address), mint: key(c.mint), destination, vault: key(c.vault), tokenProgram: key(c.tokenProgram) })
        .preInstructions(priority)
        .rpc();
    },
  };
}
