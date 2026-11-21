//! Shared LiteSVM helpers for the program's integration tests.
// Each test binary uses a different subset of these helpers.
#![allow(dead_code, unused_imports)]

pub use anchor_lang::prelude::{Clock, Pubkey};
pub use anchor_lang::solana_program::instruction::Instruction;
pub use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas};
pub use codestreak::constants::*;
pub use codestreak::state::{Challenge, Config, DayResult, Participant, ParticipantStatus, SponsorReceipt};
pub use codestreak::InitializePoolParams;
pub use litesvm::LiteSVM;
pub use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
pub use solana_keypair::Keypair;
pub use solana_message::Message;
pub use solana_signer::Signer;
pub use solana_transaction::Transaction;

pub const NOW: i64 = 1_800_000_000;
pub const START: i64 = NOW + 3_600;
pub const JOIN_DEADLINE: i64 = NOW + 3_000;
pub const END: i64 = START + 3 * 300;
pub const BUY_IN: u64 = 10_000_000; // 10 USDC
pub const PROGRAM_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/codestreak.so");

pub struct Env {
    pub svm: LiteSVM,
    pub relayer: Keypair,
    pub creator: Keypair,
    /// Co-signs joins/sponsorships for private groups (the CodeStreak relayer service in production).
    pub group_authority: Keypair,
    /// The challenge verifier (the worker's key in production); copied into each challenge.
    pub verifier: Keypair,
    pub usdc: Pubkey,
    pub other_mint: Pubkey,
}

pub fn challenge_pda(creator: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(&[CHALLENGE_SEED, creator.as_ref(), &id.to_le_bytes()], &codestreak::ID).0
}
pub fn vault_pda(challenge: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VAULT_SEED, challenge.as_ref()], &codestreak::ID).0
}
pub fn participant_pda(challenge: &Pubkey, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PARTICIPANT_SEED, challenge.as_ref(), user.as_ref()], &codestreak::ID).0
}
pub fn receipt_pda(challenge: &Pubkey, sponsor: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[SPONSOR_SEED, challenge.as_ref(), sponsor.as_ref()], &codestreak::ID).0
}

pub fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = ts;
    svm.set_sysvar(&clock);
}

pub fn setup() -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(codestreak::ID, PROGRAM_SO)
        .expect("target/deploy/codestreak.so not found: run `anchor build` first");
    set_time(&mut svm, NOW);
    let (relayer, creator, group_authority, verifier) = (Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new());
    for k in [&relayer, &creator, &group_authority, &verifier] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    let usdc = CreateMint::new(&mut svm, &relayer).decimals(6).send().unwrap();
    let other_mint = CreateMint::new(&mut svm, &relayer).decimals(6).send().unwrap();

    // Config written directly (initialize_config needs the upgrade authority; covered in pool.rs).
    let (pda, bump) = Pubkey::find_program_address(&[CONFIG_SEED], &codestreak::ID);
    let config = Config { admin: relayer.pubkey(), default_verifier: verifier.pubkey(), allowed_mints: vec![usdc], bump };
    let mut data = Vec::new();
    config.try_serialize(&mut data).unwrap();
    data.resize(8 + Config::INIT_SPACE, 0);
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(pda, solana_account::Account { lamports, data, owner: codestreak::ID, executable: false, rent_epoch: 0 })
        .unwrap();

    Env { svm, relayer, creator, group_authority, verifier, usdc, other_mint }
}

/// Creates a challenge (300-second demo days, 3 days) and returns its address.
pub fn create_pool(env: &mut Env, id: u64, private: bool, max_participants: u16) -> Pubkey {
    create_pool_with(env, id, private, max_participants, |_| {})
}

/// Like `create_pool`, with a hook to change parameters (e.g. Shield settings).
pub fn create_pool_with(env: &mut Env, id: u64, private: bool, max_participants: u16, tweak: impl FnOnce(&mut InitializePoolParams)) -> Pubkey {
    let mut params = InitializePoolParams {
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
    tweak(&mut params);
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
pub fn funded_usdc(env: &mut Env, amount: u64) -> (Keypair, Pubkey) {
    let mint = env.usdc;
    let user = Keypair::new();
    env.svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let ata = CreateAssociatedTokenAccount::new(&mut env.svm, &env.relayer, &mint).owner(&user.pubkey()).send().unwrap();
    MintTo::new(&mut env.svm, &env.relayer, &mint, &ata, amount).owner(&env.relayer).send().unwrap();
    (user, ata)
}

pub struct Accts {
    pub mint: Pubkey,
    pub user_token: Pubkey,
    pub vault: Pubkey,
    pub join_authority: Option<Pubkey>,
}

pub fn accts(challenge: &Pubkey, mint: Pubkey, user_token: Pubkey) -> Accts {
    Accts { mint, user_token, vault: vault_pda(challenge), join_authority: None }
}

pub fn join_ix(payer: &Pubkey, user: &Pubkey, challenge: &Pubkey, a: &Accts) -> Instruction {
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

pub fn sponsor_ix(payer: &Pubkey, sponsor: &Pubkey, challenge: &Pubkey, a: &Accts, amount: u64) -> Instruction {
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

pub fn send(svm: &mut LiteSVM, ix: Instruction, signers: &[&Keypair]) -> Result<Vec<String>, String> {
    let payer = signers[0].pubkey();
    let tx = Transaction::new(signers, Message::new(&[ix], Some(&payer)), svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    svm.expire_blockhash();
    match result {
        Ok(meta) => Ok(meta.logs),
        Err(failed) => Err(format!("{:?}\n{}", failed.err, failed.meta.logs.join("\n"))),
    }
}

pub fn expect_anchor_error(result: Result<Vec<String>, String>, name: &str) {
    match result {
        Ok(_) => panic!("expected error {name}, but the transaction succeeded"),
        Err(e) => assert!(e.contains(&format!("Error Code: {name}")), "expected {name}, got:\n{e}"),
    }
}

pub fn read<T: AccountDeserialize>(svm: &LiteSVM, address: &Pubkey) -> T {
    let account = svm.get_account(address).expect("account missing");
    T::try_deserialize(&mut account.data.as_slice()).unwrap()
}

pub fn token_balance(svm: &LiteSVM, address: &Pubkey) -> u64 {
    read::<anchor_spl::token::TokenAccount>(svm, address).amount
}

/// The core invariant of this phase: vault == total_stake + total_sponsor.
pub fn assert_vault_matches_deposits(svm: &LiteSVM, challenge: &Pubkey) {
    let c: Challenge = read(svm, challenge);
    assert_eq!(token_balance(svm, &c.vault), c.total_stake + c.total_sponsor + c.total_shield, "vault must equal recorded deposits");
}

pub fn verify_ix(verifier: &Pubkey, challenge: &Pubkey, user: &Pubkey, day: u16, result: DayResult) -> Instruction {
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::RecordVerification {
            verifier: *verifier,
            challenge: *challenge,
            participant: participant_pda(challenge, user),
        }
        .to_account_metas(None),
        data: codestreak::instruction::RecordVerification { day, result, evidence_hash: [7; 32] }.data(),
    }
}

pub fn shield_ix(payer: &Pubkey, user: &Pubkey, challenge: &Pubkey, user_token: &Pubkey, mint: &Pubkey, day: u16) -> Instruction {
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::ActivateShield {
            payer: *payer,
            user: *user,
            challenge: *challenge,
            participant: participant_pda(challenge, user),
            mint: *mint,
            user_token: *user_token,
            vault: vault_pda(challenge),
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::ActivateShield { day }.data(),
    }
}

/// Creates a funded user and joins them to a public `challenge`. Returns (user, their USDC account).
pub fn joined_user(env: &mut Env, challenge: &Pubkey, balance: u64) -> (Keypair, Pubkey) {
    let (user, ata) = funded_usdc(env, balance);
    let ix = join_ix(&env.relayer.pubkey(), &user.pubkey(), challenge, &accts(challenge, env.usdc, ata));
    send(&mut env.svm, ix, &[&env.relayer, &user]).unwrap();
    (user, ata)
}
