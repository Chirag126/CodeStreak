//! Phase 6: joining and sponsoring on an in-process Solana VM (LiteSVM).
//! Build the program first, then run:  anchor build && cargo test -p codestreak
use anchor_lang::prelude::{Clock, Pubkey};
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas};
use codestreak::constants::*;
use codestreak::state::{Challenge, Config, Participant, ParticipantStatus, SponsorReceipt};
use codestreak::InitializePoolParams;
use litesvm::LiteSVM;
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

const NOW: i64 = 1_800_000_000;
const START: i64 = NOW + 3_600;
const JOIN_DEADLINE: i64 = NOW + 3_000;
const END: i64 = START + 3 * 300;
const BUY_IN: u64 = 10_000_000; // 10 USDC
const PROGRAM_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/codestreak.so");

struct Env {
    svm: LiteSVM,
    relayer: Keypair,
    creator: Keypair,
    /// Co-signs joins/sponsorships for private groups (the CodeStreak relayer service in production).
    group_authority: Keypair,
    usdc: Pubkey,
    other_mint: Pubkey,
}

fn challenge_pda(creator: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(&[CHALLENGE_SEED, creator.as_ref(), &id.to_le_bytes()], &codestreak::ID).0
}
fn vault_pda(challenge: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VAULT_SEED, challenge.as_ref()], &codestreak::ID).0
}
fn participant_pda(challenge: &Pubkey, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PARTICIPANT_SEED, challenge.as_ref(), user.as_ref()], &codestreak::ID).0
}
fn receipt_pda(challenge: &Pubkey, sponsor: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[SPONSOR_SEED, challenge.as_ref(), sponsor.as_ref()], &codestreak::ID).0
}

fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = ts;
    svm.set_sysvar(&clock);
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(codestreak::ID, PROGRAM_SO)
        .expect("target/deploy/codestreak.so not found: run `anchor build` first");
    set_time(&mut svm, NOW);
    let (relayer, creator, group_authority) = (Keypair::new(), Keypair::new(), Keypair::new());
    for k in [&relayer, &creator, &group_authority] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    let usdc = CreateMint::new(&mut svm, &relayer).decimals(6).send().unwrap();
    let other_mint = CreateMint::new(&mut svm, &relayer).decimals(6).send().unwrap();

    // Config written directly (initialize_config needs the upgrade authority; covered in pool.rs).
    let (pda, bump) = Pubkey::find_program_address(&[CONFIG_SEED], &codestreak::ID);
    let config = Config { admin: relayer.pubkey(), default_verifier: relayer.pubkey(), allowed_mints: vec![usdc], bump };
    let mut data = Vec::new();
    config.try_serialize(&mut data).unwrap();
    data.resize(8 + Config::INIT_SPACE, 0);
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(pda, solana_account::Account { lamports, data, owner: codestreak::ID, executable: false, rent_epoch: 0 })
        .unwrap();

    Env { svm, relayer, creator, group_authority, usdc, other_mint }
}

/// Creates a challenge (300-second demo days, 3 days) and returns its address.
fn create_pool(env: &mut Env, id: u64, private: bool, max_participants: u16) -> Pubkey {
    let params = InitializePoolParams {
        challenge_id: id,
        buy_in: BUY_IN,
        start_ts: START,
        day_length_secs: 300,
        num_days: 3,
        join_deadline_ts: JOIN_DEADLINE,
        min_participants: 2,
        max_participants,
        shield_price: 2_000_000,
        max_shields_per_participant: 1,
        shield_grace_secs: 60,
        verify_window_secs: 600,
        dispute_window_secs: 900,
        join_authority: private.then(|| env.group_authority.pubkey()),
        rules_hash: [9; 32],
    };
    let challenge = challenge_pda(&env.creator.pubkey(), id);
    let ix = Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::InitializePool {
            payer: env.relayer.pubkey(),
            creator: env.creator.pubkey(),
            config: Pubkey::find_program_address(&[CONFIG_SEED], &codestreak::ID).0,
            challenge,
            mint: env.usdc,
            vault: vault_pda(&challenge),
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::InitializePool { params }.data(),
    };
    send(&mut env.svm, ix, &[&env.relayer, &env.creator]).unwrap();
    challenge
}

/// A funded wallet with a USDC token account (ATA) holding `amount`.
fn funded_usdc(env: &mut Env, amount: u64) -> (Keypair, Pubkey) {
    let mint = env.usdc;
    let user = Keypair::new();
    env.svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let ata = CreateAssociatedTokenAccount::new(&mut env.svm, &env.relayer, &mint).owner(&user.pubkey()).send().unwrap();
    MintTo::new(&mut env.svm, &env.relayer, &mint, &ata, amount).owner(&env.relayer).send().unwrap();
    (user, ata)
}

struct Accts {
    mint: Pubkey,
    user_token: Pubkey,
    vault: Pubkey,
    join_authority: Option<Pubkey>,
}

fn accts(challenge: &Pubkey, mint: Pubkey, user_token: Pubkey) -> Accts {
    Accts { mint, user_token, vault: vault_pda(challenge), join_authority: None }
}

fn join_ix(payer: &Pubkey, user: &Pubkey, challenge: &Pubkey, a: &Accts) -> Instruction {
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::JoinPool {
            payer: *payer,
            user: *user,
            join_authority: a.join_authority,
            challenge: *challenge,
            participant: participant_pda(challenge, user),
            mint: a.mint,
            user_token: a.user_token,
            vault: a.vault,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::JoinPool {}.data(),
    }
}

fn sponsor_ix(payer: &Pubkey, sponsor: &Pubkey, challenge: &Pubkey, a: &Accts, amount: u64) -> Instruction {
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::SponsorPool {
            payer: *payer,
            sponsor: *sponsor,
            join_authority: a.join_authority,
            challenge: *challenge,
            receipt: receipt_pda(challenge, sponsor),
            mint: a.mint,
            sponsor_token: a.user_token,
            vault: a.vault,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::SponsorPool { amount }.data(),
    }
}

fn send(svm: &mut LiteSVM, ix: Instruction, signers: &[&Keypair]) -> Result<Vec<String>, String> {
    let payer = signers[0].pubkey();
    let tx = Transaction::new(signers, Message::new(&[ix], Some(&payer)), svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    svm.expire_blockhash();
    match result {
        Ok(meta) => Ok(meta.logs),
        Err(failed) => Err(format!("{:?}\n{}", failed.err, failed.meta.logs.join("\n"))),
    }
}

fn expect_anchor_error(result: Result<Vec<String>, String>, name: &str) {
    match result {
        Ok(_) => panic!("expected error {name}, but the transaction succeeded"),
        Err(e) => assert!(e.contains(&format!("Error Code: {name}")), "expected {name}, got:\n{e}"),
    }
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, address: &Pubkey) -> T {
    let account = svm.get_account(address).expect("account missing");
    T::try_deserialize(&mut account.data.as_slice()).unwrap()
}

fn token_balance(svm: &LiteSVM, address: &Pubkey) -> u64 {
    read::<anchor_spl::token::TokenAccount>(svm, address).amount
}

/// The core invariant of this phase: vault == total_stake + total_sponsor.
fn assert_vault_matches_deposits(svm: &LiteSVM, challenge: &Pubkey) {
    let c: Challenge = read(svm, challenge);
    assert_eq!(token_balance(svm, &c.vault), c.total_stake + c.total_sponsor + c.total_shield, "vault must equal recorded deposits");
}

#[test]
fn join_deposits_buy_in_and_creates_participant_with_relayer_paying() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 1, false, 20);
    let (alice, alice_ata) = funded_usdc(&mut env, 25_000_000);
    let alice_sol_before = env.svm.get_balance(&alice.pubkey()).unwrap();

    let ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &accts(&challenge, env.usdc, alice_ata));
    send(&mut env.svm, ix, &[&env.relayer, &alice]).unwrap();

    let p: Participant = read(&env.svm, &participant_pda(&challenge, &alice.pubkey()));
    assert_eq!((p.challenge, p.user, p.deposited, p.joined_at), (challenge, alice.pubkey(), BUY_IN, NOW));
    assert_eq!(p.status, ParticipantStatus::Active);
    assert_eq!((p.verified_days, p.failed_days, p.shielded_days, p.shields_used), (0, 0, 0, 0));
    assert!(!p.finalized && !p.claimed);

    let c: Challenge = read(&env.svm, &challenge);
    assert_eq!((c.participant_count, c.total_stake), (1, BUY_IN));
    assert_eq!(token_balance(&env.svm, &alice_ata), 15_000_000);
    assert_eq!(env.svm.get_balance(&alice.pubkey()).unwrap(), alice_sol_before, "relayer pays fees and rent");
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn vault_balance_equals_all_deposits_and_sponsorships() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 2, false, 20);
    for _ in 0..3 {
        let (u, ata) = funded_usdc(&mut env, BUY_IN);
        let ix = join_ix(&env.relayer.pubkey(), &u.pubkey(), &challenge, &accts(&challenge, env.usdc, ata));
        send(&mut env.svm, ix, &[&env.relayer, &u]).unwrap();
    }
    let (sponsor, sponsor_ata) = funded_usdc(&mut env, 100_000_000);
    for amount in [5_000_000, 7_500_000] {
        let ix = sponsor_ix(&env.relayer.pubkey(), &sponsor.pubkey(), &challenge, &accts(&challenge, env.usdc, sponsor_ata), amount);
        send(&mut env.svm, ix, &[&env.relayer, &sponsor]).unwrap();
    }
    let c: Challenge = read(&env.svm, &challenge);
    assert_eq!((c.participant_count, c.total_stake, c.total_sponsor), (3, 3 * BUY_IN, 12_500_000));
    assert_eq!(token_balance(&env.svm, &c.vault), 42_500_000);
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn double_join_fails() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 3, false, 20);
    let (alice, ata) = funded_usdc(&mut env, 3 * BUY_IN);
    let a = accts(&challenge, env.usdc, ata);
    send(&mut env.svm, join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &a), &[&env.relayer, &alice]).unwrap();
    let again = send(&mut env.svm, join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &a), &[&env.relayer, &alice]);
    assert!(again.is_err(), "second join by the same wallet must fail");
    let c: Challenge = read(&env.svm, &challenge);
    assert_eq!((c.participant_count, c.total_stake), (1, BUY_IN));
    assert_eq!(token_balance(&env.svm, &ata), 2 * BUY_IN, "only one buy-in taken");
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn late_join_fails_at_and_after_join_deadline() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 4, false, 20);
    for ts in [JOIN_DEADLINE, START + 10] {
        set_time(&mut env.svm, ts);
        let (u, ata) = funded_usdc(&mut env, BUY_IN);
        let ix = join_ix(&env.relayer.pubkey(), &u.pubkey(), &challenge, &accts(&challenge, env.usdc, ata));
        expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &u]), "JoinClosed");
    }
    // One second before the deadline still works.
    set_time(&mut env.svm, JOIN_DEADLINE - 1);
    let (u, ata) = funded_usdc(&mut env, BUY_IN);
    let ix = join_ix(&env.relayer.pubkey(), &u.pubkey(), &challenge, &accts(&challenge, env.usdc, ata));
    send(&mut env.svm, ix, &[&env.relayer, &u]).unwrap();
}

#[test]
fn private_join_requires_the_group_join_authority() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 5, true, 20);
    let (alice, ata) = funded_usdc(&mut env, BUY_IN);

    // No co-signer.
    let ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &accts(&challenge, env.usdc, ata));
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &alice]), "JoinAuthorityRequired");

    // Wrong co-signer (an attacker signing as "join authority").
    let imposter = Keypair::new();
    let mut a = accts(&challenge, env.usdc, ata);
    a.join_authority = Some(imposter.pubkey());
    let ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &a);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &alice, &imposter]), "InvalidJoinAuthority");

    // Correct key listed but not signing: rejected by the Signer check.
    let mut a = accts(&challenge, env.usdc, ata);
    a.join_authority = Some(env.group_authority.pubkey());
    let mut ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &a);
    for meta in ix.accounts.iter_mut().filter(|m| m.pubkey == env.group_authority.pubkey()) {
        meta.is_signer = false;
    }
    assert!(send(&mut env.svm, ix, &[&env.relayer, &alice]).is_err());

    // Correct co-signer.
    let ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &a);
    send(&mut env.svm, ix, &[&env.relayer, &alice, &env.group_authority]).unwrap();
    let c: Challenge = read(&env.svm, &challenge);
    assert_eq!(c.participant_count, 1);
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn wrong_vault_fails() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 6, false, 20);
    let other_challenge = create_pool(&mut env, 7, false, 20);
    let (alice, ata) = funded_usdc(&mut env, 2 * BUY_IN);

    // Another challenge's vault (same mint, program-owned) must be rejected.
    let mut a = accts(&challenge, env.usdc, ata);
    a.vault = vault_pda(&other_challenge);
    let ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &a);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &alice]), "InvalidVault");

    // An attacker-owned token account as "vault".
    let (_, attacker_ata) = funded_usdc(&mut env, 0);
    let mut a = accts(&challenge, env.usdc, ata);
    a.vault = attacker_ata;
    let ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &a);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &alice]), "InvalidVault");

    // Same for sponsorships.
    let mut a = accts(&challenge, env.usdc, ata);
    a.vault = attacker_ata;
    let ix = sponsor_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &a, 1_000_000);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &alice]), "InvalidVault");

    assert_eq!(token_balance(&env.svm, &ata), 2 * BUY_IN, "no funds moved");
    assert_eq!(token_balance(&env.svm, &attacker_ata), 0);
}

#[test]
fn wrong_mint_or_someone_elses_token_account_fails() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 8, false, 20);
    let (alice, _) = funded_usdc(&mut env, BUY_IN);
    let (_, alice_other) = {
        let ata = CreateAssociatedTokenAccount::new(&mut env.svm, &env.relayer, &env.other_mint)
            .owner(&alice.pubkey())
            .send()
            .unwrap();
        MintTo::new(&mut env.svm, &env.relayer, &env.other_mint, &ata, BUY_IN).owner(&env.relayer).send().unwrap();
        ((), ata)
    };
    let ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &accts(&challenge, env.other_mint, alice_other));
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &alice]), "InvalidMint");

    // Alice tries to pay with Bob's token account.
    let (_, bob_ata) = funded_usdc(&mut env, BUY_IN);
    let ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &accts(&challenge, env.usdc, bob_ata));
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &alice]), "ConstraintTokenOwner");
    assert_eq!(token_balance(&env.svm, &bob_ata), BUY_IN);
}

#[test]
fn user_must_sign_and_needs_enough_tokens() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 9, false, 20);
    let (alice, ata) = funded_usdc(&mut env, BUY_IN);
    let mut ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &accts(&challenge, env.usdc, ata));
    for meta in ix.accounts.iter_mut().filter(|m| m.pubkey == alice.pubkey()) {
        meta.is_signer = false;
    }
    assert!(send(&mut env.svm, ix, &[&env.relayer]).is_err(), "relayer cannot join on a user's behalf");

    let (poor, poor_ata) = funded_usdc(&mut env, BUY_IN - 1);
    let ix = join_ix(&env.relayer.pubkey(), &poor.pubkey(), &challenge, &accts(&challenge, env.usdc, poor_ata));
    assert!(send(&mut env.svm, ix, &[&env.relayer, &poor]).is_err(), "insufficient balance");
    assert!(env.svm.get_account(&participant_pda(&challenge, &poor.pubkey())).is_none_or(|a| a.data.is_empty()));
}

#[test]
fn pool_full_fails() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 10, false, 2);
    for i in 0..3 {
        let (u, ata) = funded_usdc(&mut env, BUY_IN);
        let ix = join_ix(&env.relayer.pubkey(), &u.pubkey(), &challenge, &accts(&challenge, env.usdc, ata));
        let result = send(&mut env.svm, ix, &[&env.relayer, &u]);
        if i < 2 {
            result.unwrap();
        } else {
            expect_anchor_error(result, "PoolFull");
        }
    }
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn sponsor_receipt_accumulates_and_relayer_pays() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 11, false, 20);
    let (sponsor, ata) = funded_usdc(&mut env, 50_000_000);
    let sol_before = env.svm.get_balance(&sponsor.pubkey()).unwrap();
    let a = accts(&challenge, env.usdc, ata);

    send(&mut env.svm, sponsor_ix(&env.relayer.pubkey(), &sponsor.pubkey(), &challenge, &a, 4_000_000), &[&env.relayer, &sponsor]).unwrap();
    // Sponsoring is allowed while the challenge is running, too.
    set_time(&mut env.svm, START + 100);
    send(&mut env.svm, sponsor_ix(&env.relayer.pubkey(), &sponsor.pubkey(), &challenge, &a, 6_000_000), &[&env.relayer, &sponsor]).unwrap();

    let r: SponsorReceipt = read(&env.svm, &receipt_pda(&challenge, &sponsor.pubkey()));
    assert_eq!((r.challenge, r.sponsor, r.amount, r.contributions), (challenge, sponsor.pubkey(), 10_000_000, 2));
    assert_eq!((r.first_at, r.last_at, r.refunded), (NOW, START + 100, false));
    assert_eq!(env.svm.get_balance(&sponsor.pubkey()).unwrap(), sol_before);

    // A second sponsor gets a separate receipt.
    let (other, other_ata) = funded_usdc(&mut env, 1_000_000);
    let ix = sponsor_ix(&env.relayer.pubkey(), &other.pubkey(), &challenge, &accts(&challenge, env.usdc, other_ata), 1_000_000);
    send(&mut env.svm, ix, &[&env.relayer, &other]).unwrap();
    let r2: SponsorReceipt = read(&env.svm, &receipt_pda(&challenge, &other.pubkey()));
    assert_eq!((r2.amount, r2.contributions), (1_000_000, 1));

    let c: Challenge = read(&env.svm, &challenge);
    assert_eq!((c.total_sponsor, c.participant_count), (11_000_000, 0), "sponsors are not participants");
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn sponsorship_rejects_zero_late_and_private_without_cosign() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 12, false, 20);
    let (sponsor, ata) = funded_usdc(&mut env, 10_000_000);
    let a = accts(&challenge, env.usdc, ata);

    let ix = sponsor_ix(&env.relayer.pubkey(), &sponsor.pubkey(), &challenge, &a, 0);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &sponsor]), "InvalidAmount");

    set_time(&mut env.svm, END);
    let ix = sponsor_ix(&env.relayer.pubkey(), &sponsor.pubkey(), &challenge, &a, 1_000_000);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &sponsor]), "SponsorshipClosed");

    set_time(&mut env.svm, NOW);
    let private = create_pool(&mut env, 13, true, 20);
    let mut a = accts(&private, env.usdc, ata);
    let ix = sponsor_ix(&env.relayer.pubkey(), &sponsor.pubkey(), &private, &a, 1_000_000);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &sponsor]), "JoinAuthorityRequired");
    a.join_authority = Some(env.group_authority.pubkey());
    let ix = sponsor_ix(&env.relayer.pubkey(), &sponsor.pubkey(), &private, &a, 1_000_000);
    send(&mut env.svm, ix, &[&env.relayer, &sponsor, &env.group_authority]).unwrap();

    assert_eq!(token_balance(&env.svm, &ata), 9_000_000);
    assert_vault_matches_deposits(&env.svm, &private);
}
