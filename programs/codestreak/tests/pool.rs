//! Config and pool creation on an in-process Solana VM (LiteSVM).
//! Build the program first, then run:  anchor build && cargo test -p codestreak
use std::str::FromStr;

use anchor_lang::prelude::{Clock, Pubkey};
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas};
use codestreak::constants::*;
use codestreak::state::{Challenge, ChallengePhase, Config, PoolState};
use codestreak::InitializePoolParams;
use litesvm::LiteSVM;
use litesvm_token::CreateMint;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

const NOW: i64 = 1_800_000_000;
const PROGRAM_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/codestreak.so");

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    relayer: Keypair,
    creator: Keypair,
    verifier: Pubkey,
    usdc: Pubkey,
    other_mint: Pubkey,
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &codestreak::ID).0
}

fn challenge_pda(creator: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(&[CHALLENGE_SEED, creator.as_ref(), &id.to_le_bytes()], &codestreak::ID).0
}

fn vault_pda(challenge: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VAULT_SEED, challenge.as_ref()], &codestreak::ID).0
}

fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = ts;
    svm.set_sysvar(&clock);
}

/// Writes the Config account directly. In production it is created by `initialize_config`,
/// which requires the program's upgrade authority (not available for programs loaded in tests).
fn write_config(svm: &mut LiteSVM, admin: Pubkey, verifier: Pubkey, mints: Vec<Pubkey>) {
    let (pda, bump) = Pubkey::find_program_address(&[CONFIG_SEED], &codestreak::ID);
    let config = Config { admin, default_verifier: verifier, allowed_mints: mints, bump };
    let mut data = Vec::new();
    config.try_serialize(&mut data).unwrap();
    data.resize(8 + Config::INIT_SPACE, 0);
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(pda, solana_account::Account { lamports, data, owner: codestreak::ID, executable: false, rent_epoch: 0 })
        .unwrap();
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(codestreak::ID, PROGRAM_SO)
        .expect("target/deploy/codestreak.so not found: run `anchor build` first");
    set_time(&mut svm, NOW);

    let admin = Keypair::new();
    let relayer = Keypair::new();
    let creator = Keypair::new();
    for k in [&admin, &relayer, &creator] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    let usdc = CreateMint::new(&mut svm, &relayer).decimals(6).send().unwrap();
    let other_mint = CreateMint::new(&mut svm, &relayer).decimals(6).send().unwrap();
    let verifier = Keypair::new().pubkey();
    write_config(&mut svm, admin.pubkey(), verifier, vec![usdc]);

    Env { svm, admin, relayer, creator, verifier, usdc, other_mint }
}

fn params(id: u64) -> InitializePoolParams {
    InitializePoolParams {
        challenge_id: id,
        buy_in: 10_000_000,
        start_ts: NOW + 3_600,
        day_length_secs: 300,
        num_days: 3,
        join_deadline_ts: NOW + 3_000,
        min_participants: 2,
        max_participants: 20,
        shield_price: 2_000_000,
        max_shields_per_participant: 1,
        shield_grace_secs: 60,
        verify_window_secs: 600,
        dispute_window_secs: 900,
        join_authority: None,
        rules_hash: [9; 32],
    }
}

fn pool_ix(payer: &Pubkey, creator: &Pubkey, mint: &Pubkey, p: InitializePoolParams) -> Instruction {
    let challenge = challenge_pda(creator, p.challenge_id);
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::InitializePool {
            payer: *payer,
            creator: *creator,
            config: config_pda(),
            challenge,
            mint: *mint,
            vault: vault_pda(&challenge),
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::InitializePool { params: p }.data(),
    }
}

/// Sends one instruction. Ok(logs) on success; Err(error + logs) on failure.
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

fn read_challenge(svm: &LiteSVM, address: &Pubkey) -> Challenge {
    let account = svm.get_account(address).expect("challenge account missing");
    Challenge::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn creates_pool_and_program_owned_vault_with_relayer_paying() {
    let mut env = setup();
    let (relayer, creator) = (env.relayer.pubkey(), env.creator.pubkey());
    let ix = pool_ix(&relayer, &creator, &env.usdc, params(1));
    let creator_lamports_before = env.svm.get_balance(&creator).unwrap();

    send(&mut env.svm, ix, &[&env.relayer, &env.creator]).unwrap();

    let address = challenge_pda(&creator, 1);
    let c = read_challenge(&env.svm, &address);
    assert_eq!(c.creator, creator);
    assert_eq!(c.mint, env.usdc);
    assert_eq!(c.verifier, env.verifier, "verifier is copied from config");
    assert_eq!(c.buy_in, 10_000_000);
    assert_eq!(c.end_ts(), Some(NOW + 3_600 + 3 * 300));
    assert!(c.is_demo, "300-second days are a demo challenge");
    assert!(!c.is_private());
    assert_eq!(c.state, PoolState::Open);
    assert_eq!(c.created_at, NOW);
    assert_eq!((c.participant_count, c.total_stake), (0, 0));

    // Vault: an SPL token account for the challenge mint whose authority is the challenge PDA.
    let vault = vault_pda(&address);
    assert_eq!(c.vault, vault);
    let vault_account = env.svm.get_account(&vault).unwrap();
    assert_eq!(vault_account.owner, anchor_spl::token::ID);
    let token = anchor_spl::token::TokenAccount::try_deserialize(&mut vault_account.data.as_slice()).unwrap();
    assert_eq!(token.mint, env.usdc);
    assert_eq!(token.owner, address);
    assert_eq!(token.amount, 0);

    // The relayer paid all rent: the creator's balance is untouched.
    assert_eq!(env.svm.get_balance(&creator).unwrap(), creator_lamports_before);
}

#[test]
fn private_pool_records_join_authority() {
    let mut env = setup();
    let join_authority = Keypair::new().pubkey();
    let mut p = params(2);
    p.join_authority = Some(join_authority);
    let ix = pool_ix(&env.relayer.pubkey(), &env.creator.pubkey(), &env.usdc, p);
    send(&mut env.svm, ix, &[&env.relayer, &env.creator]).unwrap();
    let c = read_challenge(&env.svm, &challenge_pda(&env.creator.pubkey(), 2));
    assert_eq!(c.join_authority, Some(join_authority));
    assert!(c.is_private());
}

#[test]
fn lifecycle_phases_follow_the_clock() {
    let mut env = setup();
    let ix = pool_ix(&env.relayer.pubkey(), &env.creator.pubkey(), &env.usdc, params(3));
    send(&mut env.svm, ix, &[&env.relayer, &env.creator]).unwrap();
    let c = read_challenge(&env.svm, &challenge_pda(&env.creator.pubkey(), 3));
    let start = NOW + 3_600;
    let end = start + 900;
    assert_eq!(c.phase(NOW), ChallengePhase::Joining);
    assert_eq!(c.phase(NOW + 3_000), ChallengePhase::Starting);
    assert_eq!(c.phase(start), ChallengePhase::Active);
    assert_eq!(c.day_index(start + 299), Some(0));
    assert_eq!(c.day_index(start + 300), Some(1));
    assert_eq!(c.phase(end), ChallengePhase::Verifying);
    assert_eq!(c.phase(end + 600), ChallengePhase::DisputeWindow);
    assert_eq!(c.phase(end + 600 + 900), ChallengePhase::AwaitingSettlement);
}

#[test]
fn rejects_mint_not_on_allowlist() {
    let mut env = setup();
    let ix = pool_ix(&env.relayer.pubkey(), &env.creator.pubkey(), &env.other_mint, params(4));
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &env.creator]), "MintNotAllowed");
}

#[test]
fn rejects_invalid_parameters() {
    let mut env = setup();
    let cases: Vec<(&str, Box<dyn Fn(&mut InitializePoolParams)>)> = vec![
        ("InvalidBuyIn", Box::new(|p| p.buy_in = 0)),
        ("StartInPast", Box::new(|p| p.start_ts = NOW - 10)),
        ("InvalidJoinDeadline", Box::new(|p| p.join_deadline_ts = p.start_ts + 1)),
        ("InvalidDayLength", Box::new(|p| p.day_length_secs = 10)),
        ("InvalidNumDays", Box::new(|p| p.num_days = 0)),
        ("InvalidParticipantLimits", Box::new(|p| p.max_participants = 1)),
        ("InvalidWindow", Box::new(|p| p.verify_window_secs = 0)),
        ("InvalidShieldConfig", Box::new(|p| p.shield_price = 0)),
    ];
    for (i, (name, mutate)) in cases.into_iter().enumerate() {
        let mut p = params(100 + i as u64);
        mutate(&mut p);
        let ix = pool_ix(&env.relayer.pubkey(), &env.creator.pubkey(), &env.usdc, p);
        expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &env.creator]), name);
    }
}

#[test]
fn rejects_duplicate_challenge_id() {
    let mut env = setup();
    let ix = pool_ix(&env.relayer.pubkey(), &env.creator.pubkey(), &env.usdc, params(5));
    send(&mut env.svm, ix.clone(), &[&env.relayer, &env.creator]).unwrap();
    assert!(send(&mut env.svm, ix, &[&env.relayer, &env.creator]).is_err(), "same creator + id must not be created twice");
}

#[test]
fn creator_must_sign() {
    let mut env = setup();
    let mut ix = pool_ix(&env.relayer.pubkey(), &env.creator.pubkey(), &env.usdc, params(6));
    // Strip the creator's signer flag: the relayer alone cannot create a challenge in someone's name.
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == env.creator.pubkey() {
            meta.is_signer = false;
        }
    }
    assert!(send(&mut env.svm, ix, &[&env.relayer]).is_err());
}

#[test]
fn config_initialization_requires_upgrade_authority() {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(codestreak::ID, PROGRAM_SO).unwrap();
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();
    let upgradeable_loader = Pubkey::from_str("BPFLoaderUpgradeab1e11111111111111111111111").unwrap();
    let program_data = Pubkey::find_program_address(&[codestreak::ID.as_ref()], &upgradeable_loader).0;
    let ix = Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::InitializeConfig {
            authority: stranger.pubkey(),
            config: config_pda(),
            program: codestreak::ID,
            program_data,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::InitializeConfig {
            admin: stranger.pubkey(),
            default_verifier: stranger.pubkey(),
            allowed_mints: vec![],
        }
        .data(),
    };
    assert!(send(&mut svm, ix, &[&stranger]).is_err());
    assert!(svm.get_account(&config_pda()).is_none_or(|a| a.data.is_empty()), "config must not be created");
}

fn update_ix(admin: &Pubkey, mints: Option<Vec<Pubkey>>) -> Instruction {
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::UpdateConfig { admin: *admin, config: config_pda() }.to_account_metas(None),
        data: codestreak::instruction::UpdateConfig { new_admin: None, new_default_verifier: None, new_allowed_mints: mints }.data(),
    }
}

#[test]
fn only_admin_updates_config_and_new_mint_becomes_usable() {
    let mut env = setup();
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    let attack = update_ix(&stranger.pubkey(), Some(vec![env.other_mint]));
    expect_anchor_error(send(&mut env.svm, attack, &[&stranger]), "Unauthorized");

    let dup = update_ix(&env.admin.pubkey(), Some(vec![env.usdc, env.usdc]));
    expect_anchor_error(send(&mut env.svm, dup, &[&env.admin]), "DuplicateMint");

    let ok = update_ix(&env.admin.pubkey(), Some(vec![env.usdc, env.other_mint]));
    send(&mut env.svm, ok, &[&env.admin]).unwrap();

    let ix = pool_ix(&env.relayer.pubkey(), &env.creator.pubkey(), &env.other_mint, params(7));
    send(&mut env.svm, ix, &[&env.relayer, &env.creator]).unwrap();
}
