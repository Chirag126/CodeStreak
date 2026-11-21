//! Phase 7: verification records and Shields on an in-process Solana VM (LiteSVM).
//! Build the program first, then run:  anchor build && cargo test -p codestreak
mod common;
use common::*;
use DayResult::*;

// Timeline of the test pool: 3 days of 300 s from START; verify window 600 s; dispute window 900 s.
const VERIFY_END: i64 = END + 600;
const DISPUTE_END: i64 = VERIFY_END + 900;
const SHIELD_PRICE: u64 = 2_000_000;
const GRACE: i64 = 60;

fn day_end(day: i64) -> i64 {
    START + (day + 1) * 300
}

fn record(env: &mut Env, challenge: &Pubkey, user: &Pubkey, day: u16, result: DayResult) -> Result<Vec<String>, String> {
    let ix = verify_ix(&env.verifier.pubkey(), challenge, user, day, result);
    send(&mut env.svm, ix, &[&env.verifier])
}

fn shield(env: &mut Env, challenge: &Pubkey, user: &Keypair, ata: &Pubkey, day: u16) -> Result<Vec<String>, String> {
    let ix = shield_ix(&env.relayer.pubkey(), &user.pubkey(), challenge, ata, &env.usdc, day);
    send(&mut env.svm, ix, &[&env.relayer, user])
}

fn participant(env: &Env, challenge: &Pubkey, user: &Pubkey) -> Participant {
    read(&env.svm, &participant_pda(challenge, user))
}

/// A started pool with one joined participant (`max_shields` Shields allowed).
fn started(env: &mut Env, id: u64, max_shields: u8) -> (Pubkey, Keypair, Pubkey) {
    let challenge = create_pool_with(env, id, false, 20, |p| {
        p.max_shields_per_participant = max_shields;
        if max_shields == 0 {
            (p.shield_price, p.shield_grace_secs) = (0, 0);
        }
    });
    let (user, ata) = joined_user(env, &challenge, BUY_IN + 10 * SHIELD_PRICE);
    (challenge, user, ata)
}

#[test]
fn results_are_stored_in_day_bitmaps() {
    let mut env = setup();
    let (challenge, alice, _) = started(&mut env, 1, 1);
    let (bob, _) = joined_user(&mut env, &challenge, BUY_IN);

    set_time(&mut env.svm, day_end(0));
    record(&mut env, &challenge, &alice.pubkey(), 0, Verified).unwrap();
    record(&mut env, &challenge, &bob.pubkey(), 0, Failed).unwrap();
    set_time(&mut env.svm, day_end(1));
    record(&mut env, &challenge, &alice.pubkey(), 1, Failed).unwrap();
    set_time(&mut env.svm, day_end(2));
    let logs = record(&mut env, &challenge, &alice.pubkey(), 2, Indeterminate).unwrap();
    assert!(logs.iter().any(|l| l.starts_with("Program data:")), "DayRecorded event emitted");

    let a = participant(&env, &challenge, &alice.pubkey());
    assert_eq!((a.verified_days, a.failed_days, a.indeterminate_days, a.shielded_days), (0b001, 0b010, 0b100, 0));
    let b = participant(&env, &challenge, &bob.pubkey());
    assert_eq!((b.verified_days, b.failed_days), (0, 0b001), "results are per participant");
    // Recording results never moves funds.
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn non_verifier_fails() {
    let mut env = setup();
    let (challenge, alice, _) = started(&mut env, 2, 1);
    set_time(&mut env.svm, day_end(0));
    // The relayer, the creator and the participant themself are not the verifier.
    for signer in [&env.relayer, &env.creator, &alice] {
        let ix = verify_ix(&signer.pubkey(), &challenge, &alice.pubkey(), 0, Verified);
        expect_anchor_error(send(&mut env.svm, ix, &[signer]), "NotVerifier");
    }
    // Listing the real verifier without its signature is rejected too.
    let mut ix = verify_ix(&env.verifier.pubkey(), &challenge, &alice.pubkey(), 0, Verified);
    ix.accounts[0].is_signer = false;
    assert!(send(&mut env.svm, ix, &[&env.relayer]).is_err());
    assert_eq!(participant(&env, &challenge, &alice.pubkey()).verified_days, 0);
}

#[test]
fn verified_is_final_and_only_upgrades_are_allowed() {
    let mut env = setup();
    let (challenge, alice, _) = started(&mut env, 3, 1);
    set_time(&mut env.svm, day_end(2));
    let me = alice.pubkey();
    record(&mut env, &challenge, &me, 0, Verified).unwrap();
    expect_anchor_error(record(&mut env, &challenge, &me, 0, Failed), "VerifiedIsFinal");
    expect_anchor_error(record(&mut env, &challenge, &me, 0, Indeterminate), "VerifiedIsFinal");
    expect_anchor_error(record(&mut env, &challenge, &me, 0, Verified), "VerifiedIsFinal");

    record(&mut env, &challenge, &me, 1, Failed).unwrap();
    expect_anchor_error(record(&mut env, &challenge, &me, 1, Failed), "InvalidTransition");
    expect_anchor_error(record(&mut env, &challenge, &me, 1, Indeterminate), "InvalidTransition");
    record(&mut env, &challenge, &me, 2, Indeterminate).unwrap();
    expect_anchor_error(record(&mut env, &challenge, &me, 2, Failed), "InvalidTransition");

    // Upgrades work: Failed -> Verified and Indeterminate -> Verified.
    record(&mut env, &challenge, &me, 1, Verified).unwrap();
    record(&mut env, &challenge, &me, 2, Verified).unwrap();
    let p = participant(&env, &challenge, &me);
    assert_eq!((p.verified_days, p.failed_days, p.indeterminate_days), (0b111, 0, 0));
}

#[test]
fn results_only_after_the_day_ends_and_within_the_challenge() {
    let mut env = setup();
    let (challenge, alice, _) = started(&mut env, 4, 1);
    set_time(&mut env.svm, day_end(0) - 1);
    expect_anchor_error(record(&mut env, &challenge, &alice.pubkey(), 0, Verified), "DayNotOver");
    set_time(&mut env.svm, END + 10);
    expect_anchor_error(record(&mut env, &challenge, &alice.pubkey(), 3, Verified), "InvalidDay");
    expect_anchor_error(record(&mut env, &challenge, &alice.pubkey(), 64, Verified), "InvalidDay");
}

#[test]
fn first_results_close_with_the_verify_window_upgrades_with_the_dispute_window() {
    let mut env = setup();
    let (challenge, alice, _) = started(&mut env, 5, 1);
    let me = alice.pubkey();
    set_time(&mut env.svm, VERIFY_END - 1);
    record(&mut env, &challenge, &me, 0, Failed).unwrap();
    record(&mut env, &challenge, &me, 1, Failed).unwrap();

    // Dispute window: no new results, but upgrades are accepted.
    set_time(&mut env.svm, VERIFY_END);
    expect_anchor_error(record(&mut env, &challenge, &me, 2, Verified), "VerificationClosed");
    record(&mut env, &challenge, &me, 0, Verified).unwrap();

    // After the dispute window: nothing, not even upgrades.
    set_time(&mut env.svm, DISPUTE_END);
    expect_anchor_error(record(&mut env, &challenge, &me, 1, Verified), "VerificationClosed");

    let p = participant(&env, &challenge, &me);
    assert_eq!((p.verified_days, p.failed_days), (0b001, 0b010));
}

#[test]
fn participant_from_another_challenge_is_rejected() {
    let mut env = setup();
    let (challenge_a, _, _) = started(&mut env, 6, 1);
    let (challenge_b, bob, _) = started(&mut env, 7, 1);
    set_time(&mut env.svm, day_end(0));
    // Bob is in B, not A: his B participant account must not be writable through challenge A.
    let mut ix = verify_ix(&env.verifier.pubkey(), &challenge_a, &bob.pubkey(), 0, Failed);
    ix.accounts[2].pubkey = participant_pda(&challenge_b, &bob.pubkey());
    assert!(send(&mut env.svm, ix, &[&env.verifier]).is_err());
    assert_eq!(participant(&env, &challenge_b, &bob.pubkey()).failed_days, 0);
}

#[test]
fn shield_is_paid_into_the_vault_and_stored() {
    let mut env = setup();
    let (challenge, alice, ata) = started(&mut env, 8, 1);
    let balance_before = token_balance(&env.svm, &ata);
    let sol_before = env.svm.get_balance(&alice.pubkey()).unwrap();

    // Day 0 missed: the verifier records Failed, then Alice rescues it within the grace period.
    set_time(&mut env.svm, day_end(0));
    record(&mut env, &challenge, &alice.pubkey(), 0, Failed).unwrap();
    set_time(&mut env.svm, day_end(0) + GRACE - 1);
    let logs = shield(&mut env, &challenge, &alice, &ata, 0).unwrap();
    assert!(logs.iter().any(|l| l.starts_with("Program data:")), "ShieldActivated event emitted");

    let p = participant(&env, &challenge, &alice.pubkey());
    assert_eq!((p.shielded_days, p.shields_used, p.shield_paid), (0b001, 1, SHIELD_PRICE));
    assert_eq!(p.failed_days, 0b001, "the recorded result is kept; the Shield covers it at finalization");
    let c: Challenge = read(&env.svm, &challenge);
    assert_eq!(c.total_shield, SHIELD_PRICE);
    assert_eq!(token_balance(&env.svm, &ata), balance_before - SHIELD_PRICE);
    assert_eq!(env.svm.get_balance(&alice.pubkey()).unwrap(), sol_before, "relayer pays the fee");
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn shield_before_the_day_or_after_grace_fails() {
    let mut env = setup();
    let (challenge, alice, ata) = started(&mut env, 9, 1);
    set_time(&mut env.svm, START - 1);
    expect_anchor_error(shield(&mut env, &challenge, &alice, &ata, 0), "DayNotStarted");
    set_time(&mut env.svm, day_end(0) + GRACE);
    expect_anchor_error(shield(&mut env, &challenge, &alice, &ata, 0), "ShieldWindowClosed");
    // The last day's grace runs into the verify window; after it, closed.
    set_time(&mut env.svm, day_end(2) + GRACE);
    expect_anchor_error(shield(&mut env, &challenge, &alice, &ata, 2), "ShieldWindowClosed");
    expect_anchor_error(shield(&mut env, &challenge, &alice, &ata, 3), "InvalidDay");
    assert_eq!(participant(&env, &challenge, &alice.pubkey()).shields_used, 0);
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn shield_over_limit_fails() {
    let mut env = setup();
    let (challenge, alice, ata) = started(&mut env, 10, 2);
    set_time(&mut env.svm, START + 10);
    shield(&mut env, &challenge, &alice, &ata, 0).unwrap();
    expect_anchor_error(shield(&mut env, &challenge, &alice, &ata, 0), "DayAlreadyShielded");
    set_time(&mut env.svm, day_end(0) + 10);
    shield(&mut env, &challenge, &alice, &ata, 1).unwrap();
    set_time(&mut env.svm, day_end(1) + 10);
    expect_anchor_error(shield(&mut env, &challenge, &alice, &ata, 2), "ShieldLimitReached");

    let p = participant(&env, &challenge, &alice.pubkey());
    assert_eq!((p.shielded_days, p.shields_used, p.shield_paid), (0b011, 2, 2 * SHIELD_PRICE));
    assert_vault_matches_deposits(&env.svm, &challenge);
}

#[test]
fn shield_on_a_verified_day_or_disabled_pool_fails() {
    let mut env = setup();
    let (challenge, alice, ata) = started(&mut env, 11, 1);
    set_time(&mut env.svm, day_end(0));
    record(&mut env, &challenge, &alice.pubkey(), 0, Verified).unwrap();
    expect_anchor_error(shield(&mut env, &challenge, &alice, &ata, 0), "DayAlreadyVerified");

    let (no_shields, bob, bob_ata) = started(&mut env, 12, 0);
    expect_anchor_error(shield(&mut env, &no_shields, &bob, &bob_ata, 0), "ShieldsDisabled");
}

#[test]
fn shield_needs_own_membership_and_signature() {
    let mut env = setup();
    let (challenge, alice, ata) = started(&mut env, 13, 1);
    set_time(&mut env.svm, START + 10);

    // Not a participant: there is no Participant account to shield.
    let (stranger, stranger_ata) = funded_usdc(&mut env, SHIELD_PRICE);
    assert!(shield(&mut env, &challenge, &stranger, &stranger_ata, 0).is_err());
    assert_eq!(token_balance(&env.svm, &stranger_ata), SHIELD_PRICE);

    // The relayer cannot buy a Shield with Alice's tokens without her signature.
    let mut ix = shield_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &ata, &env.usdc, 0);
    for meta in ix.accounts.iter_mut().filter(|m| m.pubkey == alice.pubkey()) {
        meta.is_signer = false;
    }
    assert!(send(&mut env.svm, ix, &[&env.relayer]).is_err());

    // Paying from someone else's token account fails.
    let ix = shield_ix(&env.relayer.pubkey(), &alice.pubkey(), &challenge, &stranger_ata, &env.usdc, 0);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &alice]), "ConstraintTokenOwner");
    assert_eq!(participant(&env, &challenge, &alice.pubkey()).shields_used, 0);
}
