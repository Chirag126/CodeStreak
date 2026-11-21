//! Phase 6: joining and sponsoring on an in-process Solana VM (LiteSVM).
//! Build the program first, then run:  anchor build && cargo test -p codestreak
mod common;
use common::*;

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
