// The worker's view of the chain: reads (challenge, participants, sponsor receipts) and the
// transactions it sends with the verifier key. Calls are single attempts: retries live in run.ts,
// which re-checks the chain before every attempt, so a retry after a lost confirmation never
// produces a second transaction for the same thing.
import {
  AddressLookupTableProgram,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  badgeAuthorityPda,
  badgeMintPda,
  badgeTokenAccount,
  challengeMirrorRow,
  challengeTimes,
  configPda,
  Connection,
  createProgram,
  entryGatePda,
  enumVariant,
  Keypair,
  keypairWallet,
  PublicKey,
  SystemProgram,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type ChallengeAccount,
  type ChallengeMirrorRow,
  type ChallengeTimes,
  type CodestreakProgram,
  type ParticipantAccount,
} from '@codestreak/shared/program';
import {
  BATCH_LIMITS,
  computeBudgetInstructions,
  LOOKUP_TABLE_CAPACITY,
  MAX_TRANSACTION_UNITS,
  missingTableAddresses,
  packBatches,
  planComputeBudget,
  sendWithResend,
  type BatchItem,
} from '@codestreak/shared/relayer';

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

/**
 * Phase 43: one step of a challenge that can share a transaction with others. The worker packs
 * these into versioned transactions (several players per transaction) instead of one each.
 */
export type ChainOp =
  | { kind: 'record'; participant: string; day: number; result: DayResultName; hash: string }
  | { kind: 'finalize'; participant: string }
  | { kind: 'claim'; participant: ChainParticipant; payout: 'reward' | 'refund' }
  | { kind: 'sponsorRefund'; receipt: ChainSponsorReceipt }
  | { kind: 'badge'; participant: ChainParticipant };

/** Where the worker remembers its lookup table's address (the database; see jobs/verify.ts). */
export interface LookupTableStore {
  load(authority: string): Promise<string | null>;
  save(authority: string, address: string, addresses: number): Promise<void>;
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
  /**
   * Phase 43 (optional: without them every step is sent on its own). `pack` splits steps into
   * groups that each fit one transaction (indexes into `ops`); `sendBatch` sends one group as a
   * single versioned transaction: all its steps land together or none does.
   */
  pack?(c: ChainChallenge, ops: ChainOp[]): Promise<number[][]>;
  sendBatch?(c: ChainChallenge, ops: ChainOp[]): Promise<string>;
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

/**
 * Upper compute estimates per step, for packing (the real limit comes from a simulation). Measured
 * on the program (tests/batching.rs): record ~6k, finalize ~10k, payout ~17k, badge ~75k. A badge
 * also runs ~15 inner instructions and a transaction allows 64 in all, so its estimate keeps it at
 * 3 per transaction.
 */
export const STEP_UNITS: Record<ChainOp['kind'] | 'tokenAccount', number> = {
  record: 40_000,
  finalize: 40_000,
  claim: 60_000,
  sponsorRefund: 60_000,
  badge: 400_000,
  tokenAccount: 40_000,
};

const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112');
/** How often the worker re-checks its lookup table (and after a failure, when it tries again). */
const TABLE_RECHECK_MS = 10 * 60_000;

export interface SolanaChainOptions {
  /** Phase 43: without a store the worker uses no lookup table (batches still work, a little smaller). */
  tables?: LookupTableStore;
  log?: (m: string) => void;
}

export function createSolanaChain(rpcUrl: string, verifier: Keypair | null, options: SolanaChainOptions = {}): Chain {
  const connection = new Connection(rpcUrl, 'confirmed');
  const reader = createSolanaReader(connection);
  if (!verifier) return reader;
  const signer: Keypair = verifier;
  const program: CodestreakProgram = createProgram(connection, keypairWallet(signer));
  const key = (s: string) => new PublicKey(s);
  const log = options.log ?? ((m: string) => console.log(`[worker] ${m}`));

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

  const tokenAccountOf = (c: ChainChallenge, owner: string) => associatedTokenAddress(key(owner), key(c.mint), key(c.tokenProgram));

  /** Creates the owner's associated token account for the challenge's mint (rent paid by the verifier). */
  function createTokenAccountIx(c: ChainChallenge, owner: string, account: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
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
  }

  /** The owner's associated token account for the challenge's mint, created if missing. */
  async function ensureTokenAccount(c: ChainChallenge, owner: string): Promise<PublicKey> {
    const account = tokenAccountOf(c, owner);
    if (await connection.getAccountInfo(account)) return account;
    await send([createTokenAccountIx(c, owner, account)], 60_000);
    return account;
  }

  // ------------------------------------------------------------ Phase 43: lookup table + batches

  let table: AddressLookupTableAccount | null = null;
  let tableCheckedAt = 0;

  /** What every challenge transaction repeats: programs passed as accounts, mints, global PDAs. */
  async function tableAddresses(): Promise<PublicKey[]> {
    const config = await program.account.config.fetchNullable(configPda());
    return [
      SystemProgram.programId,
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      configPda(),
      entryGatePda(),
      badgeAuthorityPda(),
      NATIVE_MINT,
      ...(config?.allowedMints ?? []),
    ];
  }

  /**
   * The worker's lookup table: loaded from the store and checked on-chain; created (or topped up)
   * when missing. A table can't be used in the slot it was changed, so a new or extended table is
   * used from the next run on. Never throws: without a table, batches are just a little smaller.
   */
  async function lookupTables(): Promise<AddressLookupTableAccount[]> {
    const store = options.tables;
    if (!store) return [];
    if (Date.now() - tableCheckedAt < TABLE_RECHECK_MS) return table ? [table] : [];
    tableCheckedAt = Date.now();
    try {
      table = await ensureTable(store);
    } catch (e) {
      table = null;
      log(`lookup table: ${e instanceof Error ? e.message : String(e)}; sending without it for now`);
    }
    return table ? [table] : [];
  }

  async function ensureTable(store: LookupTableStore): Promise<AddressLookupTableAccount | null> {
    const me = signer.publicKey;
    const wanted = await tableAddresses();
    const saved = await store.load(me.toBase58());
    if (saved) {
      const current = (await connection.getAddressLookupTable(key(saved))).value;
      if (current && current.isActive() && current.state.authority?.equals(me)) {
        const missing = missingTableAddresses(current.state.addresses, wanted).slice(0, Math.min(20, LOOKUP_TABLE_CAPACITY - current.state.addresses.length));
        if (!missing.length) return current;
        await send([AddressLookupTableProgram.extendLookupTable({ payer: me, authority: me, lookupTable: current.key, addresses: missing })], 50_000);
        await store.save(me.toBase58(), current.key.toBase58(), current.state.addresses.length + missing.length);
        log(`lookup table ${current.key.toBase58()}: added ${missing.length} address(es)`);
        return current; // the new addresses are used from the next check on
      }
      log(`lookup table ${saved} is missing, closed or not the verifier's; creating a new one`);
    }
    const recentSlot = await connection.getSlot('finalized');
    const [create, address] = AddressLookupTableProgram.createLookupTable({ authority: me, payer: me, recentSlot });
    const addresses = missingTableAddresses([], wanted).slice(0, 20); // fits one transaction with the create
    await send([create, AddressLookupTableProgram.extendLookupTable({ payer: me, authority: me, lookupTable: address, addresses })], 50_000);
    await store.save(me.toBase58(), address.toBase58(), addresses.length);
    log(`lookup table ${address.toBase58()} created with ${addresses.length} addresses (used from the next run)`);
    tableCheckedAt = Date.now() - TABLE_RECHECK_MS + 60_000; // load it in a minute, once it is usable
    return null;
  }

  /** Token accounts (of claim/refund destinations) that don't exist yet. */
  async function missingTokenAccounts(c: ChainChallenge, ops: ChainOp[]): Promise<Set<string>> {
    const owners = ops.flatMap((op) => (op.kind === 'claim' ? [op.participant.user] : op.kind === 'sponsorRefund' ? [op.receipt.sponsor] : []));
    const accounts = [...new Set(owners.map((o) => tokenAccountOf(c, o).toBase58()))].map(key);
    const missing = new Set<string>();
    for (let i = 0; i < accounts.length; i += 100) {
      const chunk = accounts.slice(i, i + 100);
      const infos = await connection.getMultipleAccountsInfo(chunk);
      infos.forEach((info, j) => {
        if (!info) missing.add(chunk[j]!.toBase58());
      });
    }
    return missing;
  }

  /** The instructions of one step (a payout into a missing token account creates it first). */
  async function stepInstructions(c: ChainChallenge, op: ChainOp, missing: Set<string>): Promise<BatchItem> {
    const challenge = key(c.address);
    const payInto = async (owner: string, build: (destination: PublicKey) => Promise<TransactionInstruction>, units: number): Promise<BatchItem> => {
      const destination = tokenAccountOf(c, owner);
      const create = missing.has(destination.toBase58()) ? [createTokenAccountIx(c, owner, destination)] : [];
      return { instructions: [...create, await build(destination)], units: units + (create.length ? STEP_UNITS.tokenAccount : 0) };
    };
    switch (op.kind) {
      case 'record':
        return {
          instructions: [
            await program.methods
              .recordVerification(op.day, { [op.result]: {} } as never, Array.from(Buffer.from(op.hash, 'hex')))
              .accountsPartial({ verifier: signer.publicKey, challenge, participant: key(op.participant) })
              .instruction(),
          ],
          units: STEP_UNITS.record,
        };
      case 'finalize':
        return { instructions: [await program.methods.finalizeParticipant().accountsPartial({ challenge, participant: key(op.participant) }).instruction()], units: STEP_UNITS.finalize };
      case 'claim': {
        const p = op.participant;
        return payInto(
          p.user,
          (destination) =>
            (op.payout === 'reward' ? program.methods.claimReward() : program.methods.claimRefund())
              .accountsPartial({ challenge, participant: key(p.address), mint: key(c.mint), destination, vault: key(c.vault), tokenProgram: key(c.tokenProgram) })
              .instruction(),
          STEP_UNITS.claim,
        );
      }
      case 'sponsorRefund': {
        const r = op.receipt;
        return payInto(
          r.sponsor,
          (destination) =>
            program.methods
              .claimSponsorRefund()
              .accountsPartial({ challenge, receipt: key(r.address), mint: key(c.mint), destination, vault: key(c.vault), tokenProgram: key(c.tokenProgram) })
              .instruction(),
          STEP_UNITS.sponsorRefund,
        );
      }
      case 'badge':
        return { instructions: [await mintBadgeIx(c, op.participant)], units: STEP_UNITS.badge };
    }
  }

  async function steps(c: ChainChallenge, ops: ChainOp[]): Promise<BatchItem[]> {
    const missing = await missingTokenAccounts(c, ops);
    return Promise.all(ops.map((op) => stepInstructions(c, op, missing)));
  }

  /** One versioned transaction: simulated for its compute limit, then sent until it lands or expires. */
  async function sendVersioned(instructions: TransactionInstruction[], tables: AddressLookupTableAccount[]): Promise<string> {
    const plan = await planComputeBudget(connection, { payer: signer.publicKey, instructions, cap: MAX_TRANSACTION_UNITS, lookupTables: tables });
    if (plan.err) throw Object.assign(new Error(`Simulation failed: ${JSON.stringify(plan.err)}`), { logs: plan.logs ?? undefined });
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: blockhash,
      instructions: [...computeBudgetInstructions(plan.units, plan.microLamports), ...instructions],
    }).compileToV0Message(tables);
    const tx = new VersionedTransaction(message);
    tx.sign([signer]);
    const raw = tx.serialize();
    if (raw.length > BATCH_LIMITS.maxBytes) throw new Error(`Batch is ${raw.length} bytes, over the ${BATCH_LIMITS.maxBytes}-byte transaction limit`);
    return sendWithResend(connection, raw, { lastValidBlockHeight });
  }

  async function mintBadgeIx(c: ChainChallenge, p: ChainParticipant): Promise<TransactionInstruction> {
    const participant = key(p.address);
    return program.methods
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
    // Several CPIs (allocate, extensions, metadata, ATA): up to 400k units; the simulation sets the real limit.
    mintBadge: async (c, p) => send([await mintBadgeIx(c, p)], 400_000),
    pack: async (c, ops) => packBatches(signer.publicKey, await steps(c, ops), await lookupTables()),
    sendBatch: async (c, ops) => {
      const tables = await lookupTables();
      return sendVersioned((await steps(c, ops)).flatMap((s) => s.instructions), tables);
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
