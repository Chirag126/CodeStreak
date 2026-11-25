//! Phase 37.2: the global entry gate. Once set, creating, joining and sponsoring need the gate
//! authority (the CodeStreak relayer) as payer, so a moderated user can't go around the app by
//! sending their own transaction. Money going OUT (refunds, claims) and Shields stay open.
//! Build the program first, then run:  anchor build && cargo test -p codestreak
mod common;
use common::*;

fn set_gate_ix(admin: &Pubkey, authority: Option<Pubkey>) -> Instruction {
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::SetEntryGate {
            admin: *admin,
            config: Pubkey::find_program_address(&[CONFIG_SEED], &codestreak::ID).0,
            entry_gate: entry_gate_pda(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::SetEntryGate { authority }.data(),
    }
}

/// The setup's config admin is the relayer key; production uses a separate admin key.
fn gate_on(env: &mut Env) {
    let ix = set_gate_ix(&env.relayer.pubkey(), Some(env.relayer.pubkey()));
    send(&mut env.svm, ix, &[&env.relayer]).unwrap();
}

#[test]
fn without_a_gate_entry_is_open_as_before() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 1, false, 20);
    let (alice, ata) = funded_usdc(&mut env, BUY_IN);
    // Self-paid join (no relayer at all) still works while the gate is not created.
    let ix = join_ix(&alice.pubkey(), &alice.pubkey(), &challenge, &accts(&challenge, env.usdc, ata));
    send(&mut env.svm, ix, &[&alice]).unwrap();
    let c: Challenge = read(&env.svm, &challenge);
    assert_eq!(c.participant_count, 1);
}

#[test]
fn only_the_config_admin_can_set_the_gate() {
    let mut env = setup();
    let intruder = Keypair::new();
    env.svm.airdrop(&intruder.pubkey(), 1_000_000_000).unwrap();
    let ix = set_gate_ix(&intruder.pubkey(), Some(intruder.pubkey()));
    expect_anchor_error(send(&mut env.svm, ix, &[&intruder]), "Unauthorized");

    gate_on(&mut env);
    let gate: EntryGate = read(&env.svm, &entry_gate_pda());
    assert_eq!(gate.authority, Some(env.relayer.pubkey()));
}

#[test]
fn gated_join_needs_the_relayer_as_payer() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 2, false, 20);
    gate_on(&mut env);

    // A user sending their own join (as a banned user would): refused.
    let (mallory, m_ata) = funded_usdc(&mut env, BUY_IN);
    let ix = join_ix(&mallory.pubkey(), &mallory.pubkey(), &challenge, &accts(&challenge, env.usdc, m_ata));
    expect_anchor_error(send(&mut env.svm, ix, &[&mallory]), "EntryNotApproved");
    assert_eq!(token_balance(&env.svm, &m_ata), BUY_IN, "no stake taken");

    // Through CodeStreak (relayer pays): accepted.
    let (alice, a_ata) = funded_usdc(&mut env, BUY_IN);
    let ix = join_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &accts(&challenge, env.usdc, a_ata));
    send(&mut env.svm, ix, &[&env.relayer, &alice]).unwrap();
    let c: Challenge = read(&env.svm, &challenge);
    assert_eq!(c.participant_count, 1);
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn gated_sponsor_and_create_need_the_relayer_as_payer() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 3, false, 20);
    gate_on(&mut env);

    let (sponsor, s_ata) = funded_usdc(&mut env, 50_000_000);
    let ix = sponsor_ix(&sponsor.pubkey(), &sponsor.pubkey(), &challenge, &accts(&challenge, env.usdc, s_ata), 5_000_000);
    expect_anchor_error(send(&mut env.svm, ix, &[&sponsor]), "EntryNotApproved");
    let ix = sponsor_ix(&env.relayer.pubkey(), &sponsor.pubkey(), &challenge, &accts(&challenge, env.usdc, s_ata), 5_000_000);
    send(&mut env.svm, ix, &[&env.relayer, &sponsor]).unwrap();

    // Creating with a payer other than the relayer: refused. The relayer-paid helper still works.
    let mut ix = codestreak_create_ix(&env, 4);
    for m in ix.accounts.iter_mut().filter(|m| m.pubkey == env.relayer.pubkey()) {
        m.pubkey = env.creator.pubkey();
    }
    expect_anchor_error(send(&mut env.svm, ix, &[&env.creator]), "EntryNotApproved");
    create_pool(&mut env, 5, false, 20);
}

#[test]
fn a_fake_gate_account_is_rejected() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 6, false, 20);
    gate_on(&mut env);
    let (mallory, ata) = funded_usdc(&mut env, BUY_IN);
    let mut ix = join_ix(&mallory.pubkey(), &mallory.pubkey(), &challenge, &accts(&challenge, env.usdc, ata));
    let fake = Keypair::new().pubkey();
    for m in ix.accounts.iter_mut().filter(|m| m.pubkey == entry_gate_pda()) {
        m.pubkey = fake;
    }
    expect_anchor_error(send(&mut env.svm, ix, &[&mallory]), "ConstraintSeeds");
}

#[test]
fn refunds_and_shields_stay_open_with_the_gate_on() {
    let mut env = setup();
    // Full challenge: a Shield paid by the player alone (no relayer) works, it protects an existing stake.
    let full = create_pool(&mut env, 7, false, 20);
    let (alice, a_ata) = joined_user(&mut env, &full, 3 * BUY_IN);
    joined_user(&mut env, &full, BUY_IN);
    // Under-filled challenge: will be cancelled and refunded.
    let thin = create_pool(&mut env, 9, false, 20);
    let (bob, b_ata) = joined_user(&mut env, &thin, BUY_IN);
    gate_on(&mut env);

    set_time(&mut env.svm, START + 1);
    let ix = shield_ix(&alice.pubkey(), &alice.pubkey(), &full, &a_ata, &env.usdc, 0);
    send(&mut env.svm, ix, &[&alice]).unwrap();

    // Joining closed under the minimum: anyone cancels, the player refunds themselves.
    let anyone = Keypair::new();
    env.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    send(&mut env.svm, cancel_ix(&anyone.pubkey(), &thin), &[&anyone]).unwrap();
    send(&mut env.svm, claim_refund_ix(&thin, &bob.pubkey(), &env.usdc, &b_ata), &[&bob]).unwrap();
    assert_eq!(token_balance(&env.svm, &b_ata), BUY_IN, "full refund with the gate on");
}

#[test]
fn clearing_the_gate_reopens_entry() {
    let mut env = setup();
    let challenge = create_pool(&mut env, 8, false, 20);
    gate_on(&mut env);
    let ix = set_gate_ix(&env.relayer.pubkey(), None);
    send(&mut env.svm, ix, &[&env.relayer]).unwrap();
    let (alice, ata) = funded_usdc(&mut env, BUY_IN);
    let ix = join_ix(&alice.pubkey(), &alice.pubkey(), &challenge, &accts(&challenge, env.usdc, ata));
    send(&mut env.svm, ix, &[&alice]).unwrap();
}

/// initialize_pool with the relayer as payer, for tests that swap the payer.
fn codestreak_create_ix(env: &Env, id: u64) -> Instruction {
    let challenge = challenge_pda(&env.creator.pubkey(), id);
    let params = InitializePoolParams {
        challenge_id: id,
        buy_in: BUY_IN,
        start_ts: START,
        day_length_secs: 300,
        num_days: 3,
        join_deadline_ts: JOIN_DEADLINE,
        min_participants: 2,
        max_participants: 20,
        shield_price: 2_000_000,
        max_shields_per_participant: 1,
        shield_grace_secs: 60,
        verify_window_secs: 600,
        dispute_window_secs: 900,
        join_authority: None,
        rules_hash: [9; 32],
    };
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::InitializePool {
            payer: env.relayer.pubkey(),
            creator: env.creator.pubkey(),
            config: Pubkey::find_program_address(&[CONFIG_SEED], &codestreak::ID).0,
            entry_gate: entry_gate_pda(),
            challenge,
            mint: env.usdc,
            vault: vault_pda(&challenge),
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::InitializePool { params }.data(),
    }
}
