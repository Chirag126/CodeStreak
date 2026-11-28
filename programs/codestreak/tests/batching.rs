//! Phase 43: a 50-player challenge recorded, finalized, paid and badged with versioned (v0)
//! transactions that carry many players each, reading repeated accounts from an address lookup
//! table, exactly as the worker packs them (as many steps as fit in 1,232 bytes and 64 accounts).
//! Build the program first, then run:  anchor build && cargo test -p codestreak --test batching -- --nocapture
mod common;
use common::*;
use solana_message::{v0, AddressLookupTableAccount, VersionedMessage};
use solana_transaction::versioned::VersionedTransaction;
use DayResult::*;

const VERIFY_END: i64 = END + 600;
const DISPUTE_END: i64 = VERIFY_END + 900;
const PLAYERS: usize = 50;
/// A Solana transaction packet, signatures included.
const PACKET: usize = 1_232;
/// Accounts one transaction may lock.
const MAX_LOCKS: usize = 64;

fn day_end(day: u16) -> i64 {
    START + (i64::from(day) + 1) * 300
}

/// SetComputeUnitLimit + SetComputeUnitPrice, as the worker sends them.
fn compute_budget(units: u32, micro_lamports: u64) -> Vec<Instruction> {
    let id: Pubkey = "ComputeBudget111111111111111111111111111111".parse().unwrap();
    let mut limit = vec![2u8];
    limit.extend_from_slice(&units.to_le_bytes());
    let mut price = vec![3u8];
    price.extend_from_slice(&micro_lamports.to_le_bytes());
    vec![Instruction { program_id: id, accounts: vec![], data: limit }, Instruction { program_id: id, accounts: vec![], data: price }]
}

/// Writes an active lookup table owned by `authority` (the on-chain layout: 56-byte header, then addresses).
fn install_lookup_table(svm: &mut LiteSVM, authority: &Pubkey, addresses: Vec<Pubkey>) -> AddressLookupTableAccount {
    let key = Keypair::new().pubkey();
    let mut data = Vec::new();
    data.extend_from_slice(&1u32.to_le_bytes()); // ProgramState::LookupTable
    data.extend_from_slice(&u64::MAX.to_le_bytes()); // deactivation_slot: active
    data.extend_from_slice(&0u64.to_le_bytes()); // last_extended_slot
    data.push(0); // last_extended_slot_start_index
    data.push(1); // authority: Some
    data.extend_from_slice(authority.as_ref());
    data.extend_from_slice(&[0, 0]); // padding
    assert_eq!(data.len(), 56);
    for a in &addresses {
        data.extend_from_slice(a.as_ref());
    }
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    let owner: Pubkey = "AddressLookupTab1e1111111111111111111111111".parse().unwrap();
    svm.set_account(key, solana_account::Account { lamports, data, owner, executable: false, rent_epoch: 0 }).unwrap();
    AddressLookupTableAccount { key, addresses }
}

fn shortvec(n: usize) -> usize {
    if n < 0x80 {
        1
    } else if n < 0x4000 {
        2
    } else {
        3
    }
}

/// Serialized size of the signed transaction for this message.
fn tx_size(m: &v0::Message) -> usize {
    let sigs = usize::from(m.header.num_required_signatures);
    let mut n = shortvec(sigs) + 64 * sigs + 1 /* version */ + 3 /* header */;
    n += shortvec(m.account_keys.len()) + 32 * m.account_keys.len() + 32 /* blockhash */;
    n += shortvec(m.instructions.len());
    for ix in &m.instructions {
        n += 1 + shortvec(ix.accounts.len()) + ix.accounts.len() + shortvec(ix.data.len()) + ix.data.len();
    }
    n += shortvec(m.address_table_lookups.len());
    for l in &m.address_table_lookups {
        n += 32 + shortvec(l.writable_indexes.len()) + l.writable_indexes.len() + shortvec(l.readonly_indexes.len()) + l.readonly_indexes.len();
    }
    n
}

fn locks(m: &v0::Message) -> usize {
    m.account_keys.len() + m.address_table_lookups.iter().map(|l| l.writable_indexes.len() + l.readonly_indexes.len()).sum::<usize>()
}

fn compile(svm: &LiteSVM, payer: &Pubkey, ixs: &[Instruction], tables: &[AddressLookupTableAccount]) -> v0::Message {
    let mut all = compute_budget(1_400_000, 1_000);
    all.extend_from_slice(ixs);
    v0::Message::try_compile(payer, &all, tables, svm.latest_blockhash()).unwrap()
}

/// The worker's compute estimates per step (apps/worker/src/verify/chain.ts STEP_UNITS) and budget.
const BUDGET: u64 = 1_200_000;
const RECORD_UNITS: u64 = 40_000;
const FINALIZE_UNITS: u64 = 40_000;
const CLAIM_UNITS: u64 = 60_000;
/// ~75k units, but ~15 inner instructions each and 64 per transaction: 3 badges per transaction.
const BADGE_UNITS: u64 = 400_000;

/// The worker's packing: consecutive steps, as many per transaction as fit (bytes, accounts, compute).
fn pack(svm: &LiteSVM, payer: &Pubkey, steps: &[Vec<Instruction>], step_units: u64, tables: &[AddressLookupTableAccount]) -> Vec<Vec<Instruction>> {
    let mut out: Vec<Vec<Instruction>> = vec![];
    let mut current: Vec<Instruction> = vec![];
    let mut count = 0u64;
    for step in steps {
        let mut next = current.clone();
        next.extend(step.iter().cloned());
        let m = compile(svm, payer, &next, tables);
        if !current.is_empty() && (tx_size(&m) > PACKET || locks(&m) > MAX_LOCKS || (count + 1) * step_units > BUDGET) {
            out.push(std::mem::take(&mut current));
            current.extend(step.iter().cloned());
            count = 1;
        } else {
            current = next;
            count += 1;
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

struct Sent {
    txs: usize,
    max_units: u64,
    max_bytes: usize,
}

fn send_v0(svm: &mut LiteSVM, payer: &Keypair, ixs: &[Instruction], tables: &[AddressLookupTableAccount]) -> Result<(u64, usize), String> {
    let m = compile(svm, &payer.pubkey(), ixs, tables);
    let bytes = tx_size(&m);
    assert!(bytes <= PACKET, "transaction is {bytes} bytes");
    assert!(locks(&m) <= MAX_LOCKS);
    let tx = VersionedTransaction::try_new(VersionedMessage::V0(m), &[payer]).unwrap();
    let result = svm.send_transaction(tx);
    svm.expire_blockhash();
    match result {
        Ok(meta) => Ok((meta.compute_units_consumed, bytes)),
        Err(failed) => Err(format!("{:?}\n{}", failed.err, failed.meta.logs.join("\n"))),
    }
}

fn send_batches(svm: &mut LiteSVM, payer: &Keypair, batches: Vec<Vec<Instruction>>, tables: &[AddressLookupTableAccount]) -> Sent {
    let mut sent = Sent { txs: 0, max_units: 0, max_bytes: 0 };
    for b in batches {
        let (units, bytes) = send_v0(svm, payer, &b, tables).unwrap_or_else(|e| panic!("batch failed: {e}"));
        sent.txs += 1;
        sent.max_units = sent.max_units.max(units);
        sent.max_bytes = sent.max_bytes.max(bytes);
    }
    sent
}

fn mint_badge_ix(payer: &Pubkey, challenge: &Pubkey, user: &Pubkey) -> Instruction {
    let participant = participant_pda(challenge, user);
    let mint = Pubkey::find_program_address(&[BADGE_MINT_SEED, participant.as_ref()], &codestreak::ID).0;
    let user_badge_account =
        Pubkey::find_program_address(&[user.as_ref(), anchor_spl::token_2022::ID.as_ref(), mint.as_ref()], &anchor_spl::associated_token::ID).0;
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::MintBadge {
            payer: *payer,
            challenge: *challenge,
            participant,
            user: *user,
            badge_mint: mint,
            badge_authority: Pubkey::find_program_address(&[BADGE_AUTHORITY_SEED], &codestreak::ID).0,
            user_badge_account,
            token_program: anchor_spl::token_2022::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::MintBadge {}.data(),
    }
}

#[test]
fn fifty_players_settle_in_a_handful_of_versioned_transactions() {
    let mut env = setup();
    // Lookup-table addresses can be used from the slot after they were added.
    env.svm.warp_to_slot(100);
    set_time(&mut env.svm, NOW);
    let challenge = create_pool_with(&mut env, 43, false, PLAYERS as u16, |_| {});
    let players: Vec<(Keypair, Pubkey)> = (0..PLAYERS).map(|_| joined_user(&mut env, &challenge, BUY_IN)).collect();
    // Every 5th player fails day 2: 40 survivors split the 10 forfeited stakes.
    let survives = |i: usize| i % 5 != 0;

    // The worker's table: what every challenge transaction repeats.
    let config = Pubkey::find_program_address(&[CONFIG_SEED], &codestreak::ID).0;
    let badge_authority = Pubkey::find_program_address(&[BADGE_AUTHORITY_SEED], &codestreak::ID).0;
    let native_mint: Pubkey = "So11111111111111111111111111111111111111112".parse().unwrap();
    let table = install_lookup_table(
        &mut env.svm,
        &env.verifier.pubkey(),
        vec![
            anchor_lang::system_program::ID,
            anchor_spl::token::ID,
            anchor_spl::token_2022::ID,
            anchor_spl::associated_token::ID,
            config,
            entry_gate_pda(),
            badge_authority,
            native_mint,
            env.usdc,
        ],
    );
    let tables = [table];
    let (mut one_each, mut batched) = (0usize, 0usize);

    // 1. Record 3 days: 150 player-days.
    for day in 0..3u16 {
        set_time(&mut env.svm, day_end(day) + 10);
        let steps: Vec<Vec<Instruction>> = players
            .iter()
            .enumerate()
            .map(|(i, (kp, _))| {
                let r = if !survives(i) && day == 1 { Failed } else { Verified };
                vec![verify_ix(&env.verifier.pubkey(), &challenge, &kp.pubkey(), day, r)]
            })
            .collect();
        let batches = pack(&env.svm, &env.verifier.pubkey(), &steps, RECORD_UNITS, &tables);
        let sent = send_batches(&mut env.svm, &env.verifier, batches, &tables);
        println!("day {}: {PLAYERS} results in {} transactions (largest {} bytes, {} compute units)", day + 1, sent.txs, sent.max_bytes, sent.max_units);
        assert!(sent.txs <= 5, "day {day}: {} transactions", sent.txs);
        one_each += PLAYERS;
        batched += sent.txs;
    }
    for (kp, _) in &players {
        let p: Participant = read(&env.svm, &participant_pda(&challenge, &kp.pubkey()));
        assert_eq!(p.verified_days.count_ones() + p.failed_days.count_ones(), 3, "every day recorded once");
    }

    // 2. Finalize everyone, then settle.
    set_time(&mut env.svm, DISPUTE_END);
    let steps: Vec<Vec<Instruction>> = players.iter().map(|(kp, _)| vec![finalize_ix(&challenge, &kp.pubkey())]).collect();
    let batches = pack(&env.svm, &env.relayer.pubkey(), &steps, FINALIZE_UNITS, &tables);
    let sent = send_batches(&mut env.svm, &env.relayer, batches, &tables);
    println!("finalize: {PLAYERS} players in {} transactions (largest {} bytes, {} compute units)", sent.txs, sent.max_bytes, sent.max_units);
    assert!(sent.txs <= 3, "finalize: {} transactions", sent.txs);
    send(&mut env.svm, settle_ix(&challenge), &[&env.relayer]).unwrap();
    one_each += PLAYERS + 1;
    batched += sent.txs + 1;
    let c: Challenge = read(&env.svm, &challenge);
    assert_eq!((c.survivor_count, c.failed_count), (40, 10));

    let survivors: Vec<&(Keypair, Pubkey)> = players.iter().enumerate().filter(|(i, _)| survives(*i)).map(|(_, p)| p).collect();

    // A batch lands whole or not at all: one bad step (someone else's token account) and nobody is paid.
    let (a, b) = (survivors[0], survivors[1]);
    let bad = [claim_reward_ix(&challenge, &a.0.pubkey(), &env.usdc, &a.1), claim_reward_ix(&challenge, &b.0.pubkey(), &env.usdc, &a.1)];
    assert!(send_v0(&mut env.svm, &env.relayer, &bad, &tables).is_err());
    let first: Participant = read(&env.svm, &participant_pda(&challenge, &a.0.pubkey()));
    assert!(!first.claimed, "the good step in a failed batch must not land");

    // 3. Pay the 40 survivors.
    let steps: Vec<Vec<Instruction>> = survivors.iter().map(|(kp, ata)| vec![claim_reward_ix(&challenge, &kp.pubkey(), &env.usdc, ata)]).collect();
    let with_table = pack(&env.svm, &env.relayer.pubkey(), &steps, CLAIM_UNITS, &tables);
    let without_table = pack(&env.svm, &env.relayer.pubkey(), &steps, CLAIM_UNITS, &[]);
    println!("payouts: {} transactions with the lookup table, {} without", with_table.len(), without_table.len());
    assert!(with_table.len() <= without_table.len());
    let sent = send_batches(&mut env.svm, &env.relayer, with_table, &tables);
    println!("payouts: 40 survivors in {} transactions (largest {} bytes, {} compute units)", sent.txs, sent.max_bytes, sent.max_units);
    assert!(sent.txs <= 4, "payouts: {} transactions", sent.txs);
    one_each += survivors.len();
    batched += sent.txs;

    // Everyone got exactly their stake + 100 / 40 = 2.5 USDC, and the vault is empty.
    for (_, ata) in &survivors {
        assert_eq!(token_balance(&env.svm, ata), BUY_IN + 2_500_000);
    }
    assert_eq!(token_balance(&env.svm, &vault_pda(&challenge)), 0, "vault must end at exactly 0");
    let c: Challenge = read(&env.svm, &challenge);
    assert_eq!(c.total_paid_out, c.total_stake);

    // 4. Soulbound badges for the 40 survivors.
    let steps: Vec<Vec<Instruction>> = survivors.iter().map(|(kp, _)| vec![mint_badge_ix(&env.relayer.pubkey(), &challenge, &kp.pubkey())]).collect();
    let batches = pack(&env.svm, &env.relayer.pubkey(), &steps, BADGE_UNITS, &tables);
    let sent = send_batches(&mut env.svm, &env.relayer, batches, &tables);
    println!("badges: 40 survivors in {} transactions (largest {} bytes, {} compute units)", sent.txs, sent.max_bytes, sent.max_units);
    assert!(sent.txs <= 14, "badges: {} transactions", sent.txs);
    for (kp, _) in &survivors {
        let participant = participant_pda(&challenge, &kp.pubkey());
        let mint = Pubkey::find_program_address(&[BADGE_MINT_SEED, participant.as_ref()], &codestreak::ID).0;
        assert!(env.svm.get_account(&mint).is_some_and(|a| a.owner == anchor_spl::token_2022::ID), "badge minted");
    }
    one_each += survivors.len();
    batched += sent.txs;

    println!("50-player challenge: {batched} transactions instead of {one_each}");
    assert!(batched * 5 <= one_each, "at least 5x fewer transactions");
}
