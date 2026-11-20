#!/usr/bin/env node
// Phase 2 spike A: MetaMask (Solana, devnet) + relayer co-signing.
//
//   cd spikes && pnpm install && pnpm cosign     -> open http://localhost:4010
//
// Proves, against real devnet:
//   1. The wallet is discoverable through the Wallet Standard (or via MetaMask's SDK).
//   2. solana:signMessage works and the ed25519 signature verifies on the server.
//   3. solana:signTransaction signs a transaction whose FEE PAYER is our relayer,
//      returns it unmodified, and the relayer can add its signature and submit it.
//   4. Same for an SPL token (devnet USDC) instruction.
//
// Safety: devnet only; the relayer signs ONLY the exact message bytes this server built.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { buildSignInMessage, newNonce, verifySolanaSignature } from '../lib/wallet-auth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SPIKE_PORT ?? 4010);
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

if (/mainnet/i.test(RPC) || process.env.SOLANA_CLUSTER !== 'devnet') {
  console.error('Refusing to run: SOLANA_CLUSTER must be devnet and the RPC URL must not be mainnet.');
  process.exit(1);
}

function loadRelayer() {
  const json = process.env.RELAYER_KEYPAIR_JSON ?? (process.env.RELAYER_KEYPAIR_PATH ? readFileSync(process.env.RELAYER_KEYPAIR_PATH, 'utf8') : null);
  if (!json) {
    console.error('Set RELAYER_KEYPAIR_PATH in .env.local, e.g.');
    console.error('  RELAYER_KEYPAIR_PATH=\\\\wsl.localhost\\Ubuntu\\home\\<you>\\.config\\codestreak\\keys\\relayer.json');
    process.exit(1);
  }
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));
  if (process.env.RELAYER_PUBKEY && kp.publicKey.toBase58() !== process.env.RELAYER_PUBKEY) {
    console.error(`Relayer keypair (${kp.publicKey.toBase58()}) does not match RELAYER_PUBKEY (${process.env.RELAYER_PUBKEY}).`);
    process.exit(1);
  }
  return kp;
}

const relayer = loadRelayer();
const connection = new Connection(RPC, 'confirmed');
const nonces = new Map(); // nonce -> { address, message, expires }
const pending = new Map(); // buildId -> { address, kind, message(base64), blockhash, lastValidBlockHeight, expires }
const TTL_MS = 5 * 60 * 1000;

const log = (ok, step, detail = '') => console.log(`${ok ? '✔' : '✖'} ${step}${detail ? `  ${detail}` : ''}`);

function ataOf(owner, mint) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
}

// ---------------------------------------------------------------- handlers

async function config() {
  const bal = await connection.getBalance(relayer.publicKey);
  return { relayer: relayer.publicKey.toBase58(), relayerSol: bal / 1e9, rpc: RPC.replace(/api-key=[^&]+/, 'api-key=***'), usdcMint: USDC_MINT.toBase58() };
}

async function balances({ address }) {
  const owner = new PublicKey(address);
  const sol = (await connection.getBalance(owner)) / 1e9;
  let usdc = null;
  try {
    const b = await connection.getTokenAccountBalance(ataOf(owner, USDC_MINT));
    usdc = b.value.uiAmountString;
  } catch {
    usdc = '0 (no USDC account yet)';
  }
  log(true, 'balances', `${address} SOL=${sol} USDC=${usdc}`);
  return { sol, usdc };
}

function createNonce({ address, domain }) {
  new PublicKey(address); // throws on a non-Solana address (e.g. an 0x Ethereum address)
  const nonce = newNonce();
  const message = buildSignInMessage({ domain, address, nonce, issuedAt: new Date().toISOString() });
  nonces.set(nonce, { address, message, expires: Date.now() + TTL_MS });
  return { nonce, message };
}

function verifyMessage({ address, nonce, signedMessage, signature }) {
  const entry = nonces.get(nonce);
  nonces.delete(nonce); // single use, even when verification fails
  if (!entry || entry.expires < Date.now()) throw new Error('unknown or expired nonce');
  if (entry.address !== address) throw new Error('nonce was issued for another address');
  const signed = Buffer.from(signedMessage, 'base64');
  const sameMessage = signed.toString('utf8') === entry.message;
  const ok = verifySolanaSignature(address, signed, Buffer.from(signature, 'base64'));
  log(ok && sameMessage, 'signMessage verification', `signature_valid=${ok} message_unchanged=${sameMessage}`);
  if (!sameMessage) throw new Error('wallet returned a different message than the one issued');
  if (!ok) throw new Error('signature invalid');
  return { verified: true };
}

async function build({ address, kind }) {
  const user = new PublicKey(address);
  const id = randomBytes(6).toString('hex');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: relayer.publicKey, blockhash, lastValidBlockHeight });

  if (kind === 'memo') {
    tx.add(
      new TransactionInstruction({
        programId: MEMO_PROGRAM,
        keys: [{ pubkey: user, isSigner: true, isWritable: false }],
        data: Buffer.from(`CodeStreak phase-2 spike ${id}`, 'utf8'),
      }),
    );
  } else if (kind === 'usdc') {
    // Self-transfer of 0.01 devnet USDC: exercises a token instruction signed by the user
    // while the relayer pays the fee. No funds change hands.
    const ata = ataOf(user, USDC_MINT);
    const info = await connection.getAccountInfo(ata);
    if (!info) throw new Error('this wallet has no devnet USDC account yet; get USDC from faucet.circle.com first');
    const data = Buffer.alloc(10);
    data[0] = 12; // TransferChecked
    data.writeBigUInt64LE(10_000n, 1); // 0.01 USDC (6 decimals)
    data[9] = 6;
    tx.add(
      new TransactionInstruction({
        programId: TOKEN_PROGRAM,
        keys: [
          { pubkey: ata, isSigner: false, isWritable: true },
          { pubkey: USDC_MINT, isSigner: false, isWritable: false },
          { pubkey: ata, isSigner: false, isWritable: true },
          { pubkey: user, isSigner: true, isWritable: false },
        ],
        data,
      }),
    );
  } else {
    throw new Error(`unknown kind ${kind}`);
  }

  const message = tx.serializeMessage().toString('base64');
  pending.set(id, { address, kind, message, blockhash, lastValidBlockHeight, expires: Date.now() + TTL_MS });
  log(true, `built ${kind} tx`, `id=${id} fee_payer=relayer user=${address}`);
  return { id, transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') };
}

async function submit({ id, signedTransaction, chainUsed }) {
  const entry = pending.get(id);
  pending.delete(id);
  if (!entry || entry.expires < Date.now()) throw new Error('unknown or expired build id');

  const tx = Transaction.from(Buffer.from(signedTransaction, 'base64'));
  const user = new PublicKey(entry.address);

  // 1. The wallet must not have changed anything (instructions, fee payer, blockhash...).
  const unchanged = tx.serializeMessage().toString('base64') === entry.message;
  log(unchanged, `${entry.kind}: wallet returned the exact message we built`, unchanged ? '' : `instructions now=${tx.instructions.length}`);
  if (!unchanged) throw new Error('WALLET MODIFIED THE TRANSACTION: the relayer refuses to co-sign it');

  // 2. The user's signature is present and valid.
  const userSig = tx.signatures.find((s) => s.publicKey.equals(user));
  const userSigned = Boolean(userSig?.signature);
  const partialOk = userSigned && tx.verifySignatures(false);
  log(partialOk, `${entry.kind}: user signature valid`, `chain_id_used=${chainUsed}`);
  if (!partialOk) throw new Error('user signature missing or invalid');

  // 3. Relayer co-signs as fee payer and submits through OUR devnet RPC.
  tx.partialSign(relayer);
  if (!tx.verifySignatures(true)) throw new Error('fully signed transaction failed verification');
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature, blockhash: entry.blockhash, lastValidBlockHeight: entry.lastValidBlockHeight }, 'confirmed');
  const explorer = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  log(true, `${entry.kind}: CONFIRMED on devnet`, explorer);
  return { signature, explorer };
}

// ---------------------------------------------------------------- HTTP

const routes = {
  'GET /api/config': () => config(),
  'POST /api/balances': (b) => balances(b),
  'POST /api/nonce': (b) => createNonce(b),
  'POST /api/verify-message': (b) => verifyMessage(b),
  'POST /api/build': (b) => build(b),
  'POST /api/submit': (b) => submit(b),
};

const server = http.createServer(async (req, res) => {
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      return send(200, readFileSync(path.join(here, 'public', 'index.html')), 'text/html; charset=utf-8');
    }
    const handler = routes[`${req.method} ${req.url}`];
    if (!handler) return send(404, { error: 'not found' });
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 64 * 1024) throw new Error('request too large');
    }
    const body = raw ? JSON.parse(raw) : {};
    send(200, await handler(body));
  } catch (e) {
    log(false, `${req.method} ${req.url}`, e.message);
    send(400, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  const c = await config().catch((e) => ({ error: e.message }));
  console.log(`\nCodeStreak co-sign spike on http://localhost:${PORT}`);
  console.log(`relayer ${c.relayer} has ${c.relayerSol} devnet SOL, RPC ${c.rpc}`);
  console.log('Open the page in the browser where MetaMask is installed.\n');
});
