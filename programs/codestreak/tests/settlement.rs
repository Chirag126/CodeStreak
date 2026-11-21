//! Phase 8: finalization, settlement, cancellation and claims on an in-process Solana VM (LiteSVM).
//! Every outcome is played end to end with real token balances, and the vault must end at exactly 0.
//! Build the program first, then run:  anchor build && cargo test -p codestreak
mod common;
use common::*;
use DayResult::*;

const VERIFY_END: i64 = END + 600;
const DISPUTE_END: i64 = VERIFY_END + 900;
const SHIELD: u64 = 2_000_000;
/// Every player starts with one buy-in plus one Shield.
const START_BALANCE: u64 = BUY_IN + SHIELD;

struct Player {
    kp: Keypair,
    ata: Pubkey,
}

struct Scenario {
    challenge: Pubkey,
    players: Vec<Player>,
    sponsor: Option<Player>,
}

/// What the verifier records for each of the 3 days (None = never recorded), and an optional Shield day.
type Plan = ([Option<DayResult>; 3], Option<u16>);

fn day_end(day: u16) -> i64 {
    START + (i64::from(day) + 1) * 300
}

fn bal(env: &Env, ata: &Pubkey) -> u64 {
    token_balance(&env.svm, ata)
}

fn vault_balance(env: &Env, s: &Scenario) -> u64 {
    token_balance(&env.svm, &vault_pda(&s.challenge))
}

fn challenge_of(env: &Env, s: &Scenario) -> Challenge {
    read(&env.svm, &s.challenge)
}

fn status_of(env: &Env, s: &Scenario, i: usize) -> ParticipantStatus {
    read::<Participant>(&env.svm, &participant_pda(&s.challenge, &s.players[i].kp.pubkey())).status
}

/// Creates a challenge, joins one player per plan, sponsors, buys the planned Shields and records
/// all results. Leaves the clock at END (verification window open, nothing finalized).
fn prepare(env: &mut Env, id: u64, plans: &[Plan], sponsor_amount: u64, tweak: impl FnOnce(&mut InitializePoolParams)) -> Scenario {
    let challenge = create_pool_with(env, id, false, 20, tweak);
    let players: Vec<Player> = plans
        .iter()
        .map(|_| {
            let (kp, ata) = joined_user(env, &challenge, START_BALANCE);
            Player { kp, ata }
        })
        .collect();
    let sponsor = (sponsor_amount > 0).then(|| {
        let (kp, ata) = funded_usdc(env, sponsor_amount);
        let ix = sponsor_ix(&env.relayer.pubkey(), &kp.pubkey(), &challenge, &accts(&challenge, env.usdc, ata), sponsor_amount);
        send(&mut env.svm, ix, &[&env.relayer, &kp]).unwrap();
        Player { kp, ata }
    });
    for day in 0..3u16 {
        set_time(&mut env.svm, day_end(day) + 10);
        for (player, (_, shield_day)) in players.iter().zip(plans) {
            if *shield_day == Some(day) {
                let ix = shield_ix(&env.relayer.pubkey(), &player.kp.pubkey(), &challenge, &player.ata, &env.usdc, day);
                send(&mut env.svm, ix, &[&env.relayer, &player.kp]).unwrap();
            }
        }
    }
    set_time(&mut env.svm, END);
    for (player, (days, _)) in players.iter().zip(plans) {
        for (day, result) in days.iter().enumerate() {
            if let Some(r) = result {
                let ix = verify_ix(&env.verifier.pubkey(), &challenge, &player.kp.pubkey(), day as u16, *r);
                send(&mut env.svm, ix, &[&env.verifier]).unwrap();
            }
        }
    }
    Scenario { challenge, players, sponsor }
}

fn finalize_all(env: &mut Env, s: &Scenario) {
    for p in &s.players {
        send(&mut env.svm, finalize_ix(&s.challenge, &p.kp.pubkey()), &[&env.relayer]).unwrap();
    }
}

/// prepare + move past the dispute window + finalize everyone + settle.
fn settled(env: &mut Env, id: u64, plans: &[Plan], sponsor_amount: u64) -> Scenario {
    let s = prepare(env, id, plans, sponsor_amount, |_| {});
    set_time(&mut env.svm, DISPUTE_END);
    finalize_all(env, &s);
    send(&mut env.svm, settle_ix(&s.challenge), &[&env.relayer]).unwrap();
    s
}

/// Claims are permissionless to send (the relayer sends them here); funds go to the owner's account.
fn claim_reward(env: &mut Env, s: &Scenario, i: usize) -> Result<Vec<String>, String> {
    let p = &s.players[i];
    let ix = claim_reward_ix(&s.challenge, &p.kp.pubkey(), &env.usdc, &p.ata);
    send(&mut env.svm, ix, &[&env.relayer])
}

fn claim_refund(env: &mut Env, s: &Scenario, i: usize) -> Result<Vec<String>, String> {
    let p = &s.players[i];
    let ix = claim_refund_ix(&s.challenge, &p.kp.pubkey(), &env.usdc, &p.ata);
    send(&mut env.svm, ix, &[&env.relayer])
}

fn claim_sponsor(env: &mut Env, s: &Scenario) -> Result<Vec<String>, String> {
    let p = s.sponsor.as_ref().unwrap();
    let ix = claim_sponsor_refund_ix(&s.challenge, &p.kp.pubkey(), &env.usdc, &p.ata);
    send(&mut env.svm, ix, &[&env.relayer])
}

fn assert_fully_paid_out(env: &Env, s: &Scenario) {
    assert_eq!(vault_balance(env, s), 0, "vault must end at exactly 0");
    let c = challenge_of(env, s);
    assert_eq!(c.total_paid_out, c.total_stake + c.total_sponsor + c.total_shield);
}

const ALL_VERIFIED: [Option<DayResult>; 3] = [Some(Verified), Some(Verified), Some(Verified)];

// ---------------------------------------------------------------- the 6 outcome cases

#[test]
fn case1_survivors_split_forfeits_sponsors_and_shields_with_dust_to_last_claimer() {
    let mut env = setup();
    let plans: [Plan; 3] = [
        (ALL_VERIFIED, None),                                    // alice: survives
        ([Some(Verified), Some(Failed), Some(Verified)], Some(1)), // bob: missed day 1, shielded it
        ([Some(Verified), Some(Failed), Some(Failed)], None),      // carol: fails
    ];
    let s = settled(&mut env, 1, &plans, 1_000_001);

    // R = carol's 10 + sponsor 1.000001 + bob's Shield 2 = 13.000001; 2 survivors -> 6.5 each, dust 0.000001.
    let c = challenge_of(&env, &s);
    assert_eq!((c.survivor_count, c.failed_count, c.voided_count), (2, 1, 0));
    assert!(!c.full_refund);
    assert_eq!((c.reward_pool, c.reward_per_survivor, c.reward_dust), (13_000_001, 6_500_000, 1));
    assert_eq!(status_of(&env, &s, 1), ParticipantStatus::Survived);
    assert_eq!(status_of(&env, &s, 2), ParticipantStatus::Failed);

    claim_reward(&mut env, &s, 0).unwrap();
    assert_eq!(bal(&env, &s.players[0].ata), SHIELD + BUY_IN + 6_500_000);
    claim_reward(&mut env, &s, 1).unwrap();
    assert_eq!(bal(&env, &s.players[1].ata), BUY_IN + 6_500_000 + 1, "last survivor gets the dust");

    // Carol and the sponsor get nothing; their money was the reward.
    expect_anchor_error(claim_reward(&mut env, &s, 2), "NothingToClaim");
    expect_anchor_error(claim_refund(&mut env, &s, 2), "NothingToClaim");
    expect_anchor_error(claim_sponsor(&mut env, &s), "NothingToClaim");
    assert_fully_paid_out(&env, &s);
}

#[test]
fn case2_everyone_survives_and_shares_the_sponsorship() {
    let mut env = setup();
    let s = settled(&mut env, 2, &[(ALL_VERIFIED, None), (ALL_VERIFIED, None)], 3_000_000);
    let c = challenge_of(&env, &s);
    assert_eq!((c.survivor_count, c.reward_pool, c.reward_per_survivor, c.reward_dust), (2, 3_000_000, 1_500_000, 0));
    for i in 0..2 {
        claim_reward(&mut env, &s, i).unwrap();
        assert_eq!(bal(&env, &s.players[i].ata), SHIELD + BUY_IN + 1_500_000);
    }
    expect_anchor_error(claim_sponsor(&mut env, &s), "NothingToClaim");
    assert_fully_paid_out(&env, &s);
}

#[test]
fn case3_nobody_survives_so_everyone_is_refunded_in_full() {
    let mut env = setup();
    let plans: [Plan; 2] = [
        ([Some(Verified), Some(Failed), Some(Failed)], Some(1)), // shielded day 1 but failed day 2
        ([Some(Failed), Some(Failed), Some(Failed)], None),
    ];
    let s = settled(&mut env, 3, &plans, 5_000_000);
    let c = challenge_of(&env, &s);
    assert_eq!((c.survivor_count, c.failed_count), (0, 2));
    assert!(c.full_refund);

    expect_anchor_error(claim_reward(&mut env, &s, 0), "NothingToClaim");
    claim_refund(&mut env, &s, 0).unwrap();
    assert_eq!(bal(&env, &s.players[0].ata), START_BALANCE, "stake and Shield back");
    claim_refund(&mut env, &s, 1).unwrap();
    assert_eq!(bal(&env, &s.players[1].ata), START_BALANCE);
    claim_sponsor(&mut env, &s).unwrap();
    assert_eq!(bal(&env, &s.sponsor.as_ref().unwrap().ata), 5_000_000);
    assert_fully_paid_out(&env, &s);
}

#[test]
fn case4_voided_participants_get_their_stake_back() {
    let mut env = setup();
    let plans: [Plan; 4] = [
        (ALL_VERIFIED, None),                                           // survives
        ([Some(Verified), Some(Indeterminate), Some(Verified)], None),  // provider outage -> voided
        ([Some(Verified), Some(Verified), None], None),                 // never recorded -> voided
        ([Some(Failed), Some(Verified), Some(Verified)], None),         // fails
    ];
    let s = settled(&mut env, 4, &plans, 0);
    let c = challenge_of(&env, &s);
    assert_eq!((c.survivor_count, c.voided_count, c.failed_count), (1, 2, 1));
    assert_eq!((c.reward_pool, c.reward_per_survivor), (BUY_IN, BUY_IN));

    claim_reward(&mut env, &s, 0).unwrap();
    assert_eq!(bal(&env, &s.players[0].ata), SHIELD + 2 * BUY_IN);
    for i in [1, 2] {
        expect_anchor_error(claim_reward(&mut env, &s, i), "NothingToClaim");
        claim_refund(&mut env, &s, i).unwrap();
        assert_eq!(bal(&env, &s.players[i].ata), START_BALANCE, "voided: stake back, no reward");
    }
    expect_anchor_error(claim_refund(&mut env, &s, 3), "NothingToClaim");
    assert_eq!(bal(&env, &s.players[3].ata), SHIELD);
    assert_fully_paid_out(&env, &s);
}

#[test]
fn case5_everyone_voided_means_full_refund() {
    let mut env = setup();
    let plans: [Plan; 2] = [([Some(Verified), Some(Indeterminate), Some(Verified)], None), ([None, None, None], None)];
    let s = settled(&mut env, 5, &plans, 4_000_000);
    let c = challenge_of(&env, &s);
    assert_eq!((c.survivor_count, c.voided_count), (0, 2));
    assert!(c.full_refund);
    for i in 0..2 {
        claim_refund(&mut env, &s, i).unwrap();
        assert_eq!(bal(&env, &s.players[i].ata), START_BALANCE);
    }
    claim_sponsor(&mut env, &s).unwrap();
    assert_eq!(bal(&env, &s.sponsor.as_ref().unwrap().ata), 4_000_000);
    assert_fully_paid_out(&env, &s);
}

#[test]
fn case6_undersubscribed_challenge_is_cancelled_and_refunded() {
    let mut env = setup();
    let challenge = create_pool_with(&mut env, 6, false, 20, |p| p.min_participants = 3);
    let players: Vec<Player> = (0..2)
        .map(|_| {
            let (kp, ata) = joined_user(&mut env, &challenge, START_BALANCE);
            Player { kp, ata }
        })
        .collect();
    let (skp, sata) = funded_usdc(&mut env, 2_000_000);
    let ix = sponsor_ix(&env.relayer.pubkey(), &skp.pubkey(), &challenge, &accts(&challenge, env.usdc, sata), 2_000_000);
    send(&mut env.svm, ix, &[&env.relayer, &skp]).unwrap();
    let s = Scenario { challenge, players, sponsor: Some(Player { kp: skp, ata: sata }) };

    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    expect_anchor_error(claim_refund(&mut env, &s, 0), "NotSettled");
    // Joining is still open: nobody but the creator can cancel yet.
    expect_anchor_error(send(&mut env.svm, cancel_ix(&stranger.pubkey(), &challenge), &[&stranger]), "CannotCancel");

    // Joining closed with 2 < 3 participants: anyone can cancel.
    set_time(&mut env.svm, JOIN_DEADLINE);
    send(&mut env.svm, cancel_ix(&stranger.pubkey(), &challenge), &[&stranger]).unwrap();
    expect_anchor_error(send(&mut env.svm, cancel_ix(&env.creator.pubkey(), &challenge), &[&env.creator]), "ChallengeCancelled");

    for i in 0..2 {
        expect_anchor_error(claim_reward(&mut env, &s, i), "ChallengeCancelled");
        claim_refund(&mut env, &s, i).unwrap();
        assert_eq!(bal(&env, &s.players[i].ata), START_BALANCE);
        expect_anchor_error(claim_refund(&mut env, &s, i), "AlreadyClaimed");
    }
    claim_sponsor(&mut env, &s).unwrap();
    expect_anchor_error(claim_sponsor(&mut env, &s), "AlreadyClaimed");
    assert_eq!(bal(&env, &s.sponsor.as_ref().unwrap().ata), 2_000_000);
    assert_fully_paid_out(&env, &s);

    // Nothing else works on a cancelled challenge.
    let (late, late_ata) = funded_usdc(&mut env, BUY_IN);
    set_time(&mut env.svm, NOW);
    let ix = join_ix(&env.relayer.pubkey(), &late.pubkey(), &challenge, &accts(&challenge, env.usdc, late_ata));
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer, &late]), "JoinClosed");
}

// ---------------------------------------------------------------- cancellation rules

#[test]
fn creator_can_cancel_only_before_start() {
    let mut env = setup();
    let a = create_pool(&mut env, 7, false, 20);
    let b = create_pool(&mut env, 8, false, 20);
    for c in [a, b] {
        joined_user(&mut env, &c, BUY_IN);
        joined_user(&mut env, &c, BUY_IN);
    }
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    set_time(&mut env.svm, JOIN_DEADLINE);
    // Minimum reached: a stranger cannot cancel.
    expect_anchor_error(send(&mut env.svm, cancel_ix(&stranger.pubkey(), &a), &[&stranger]), "CannotCancel");
    send(&mut env.svm, cancel_ix(&env.creator.pubkey(), &a), &[&env.creator]).unwrap();
    assert_eq!(read::<Challenge>(&env.svm, &a).state, codestreak::state::PoolState::Cancelled);

    set_time(&mut env.svm, START);
    expect_anchor_error(send(&mut env.svm, cancel_ix(&env.creator.pubkey(), &b), &[&env.creator]), "CannotCancel");
    // The creator must sign.
    let mut ix = cancel_ix(&env.creator.pubkey(), &b);
    ix.accounts[0].is_signer = false;
    assert!(send(&mut env.svm, ix, &[&env.relayer]).is_err());
}

// ---------------------------------------------------------------- ordering and double actions

#[test]
fn early_settle_double_finalize_and_double_claim_fail() {
    let mut env = setup();
    let s = prepare(&mut env, 9, &[(ALL_VERIFIED, None), (ALL_VERIFIED, None)], 1_000_000, |_| {});
    let (alice, bob) = (s.players[0].kp.pubkey(), s.players[1].kp.pubkey());

    // Early: windows still open.
    set_time(&mut env.svm, DISPUTE_END - 1);
    expect_anchor_error(send(&mut env.svm, finalize_ix(&s.challenge, &alice), &[&env.relayer]), "TooEarly");
    expect_anchor_error(send(&mut env.svm, settle_ix(&s.challenge), &[&env.relayer]), "TooEarly");

    set_time(&mut env.svm, DISPUTE_END);
    expect_anchor_error(send(&mut env.svm, settle_ix(&s.challenge), &[&env.relayer]), "NotAllFinalized");
    send(&mut env.svm, finalize_ix(&s.challenge, &alice), &[&env.relayer]).unwrap();
    expect_anchor_error(send(&mut env.svm, finalize_ix(&s.challenge, &alice), &[&env.relayer]), "AlreadyFinalized");
    expect_anchor_error(send(&mut env.svm, settle_ix(&s.challenge), &[&env.relayer]), "NotAllFinalized");
    send(&mut env.svm, finalize_ix(&s.challenge, &bob), &[&env.relayer]).unwrap();
    expect_anchor_error(claim_reward(&mut env, &s, 0), "NotSettled");
    // Finalized results are frozen: no more Shields.
    let ix = shield_ix(&env.relayer.pubkey(), &alice, &s.challenge, &s.players[0].ata, &env.usdc, 2);
    assert!(send(&mut env.svm, ix, &[&env.relayer, &s.players[0].kp]).is_err());

    send(&mut env.svm, settle_ix(&s.challenge), &[&env.relayer]).unwrap();
    expect_anchor_error(send(&mut env.svm, settle_ix(&s.challenge), &[&env.relayer]), "AlreadySettled");
    expect_anchor_error(send(&mut env.svm, finalize_ix(&s.challenge, &alice), &[&env.relayer]), "AlreadySettled");
    let ix = verify_ix(&env.verifier.pubkey(), &s.challenge, &alice, 0, Verified);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.verifier]), "VerificationClosed");
    expect_anchor_error(send(&mut env.svm, cancel_ix(&env.creator.pubkey(), &s.challenge), &[&env.creator]), "AlreadySettled");

    // Payout can't be redirected to someone else's account.
    let ix = claim_reward_ix(&s.challenge, &alice, &env.usdc, &s.players[1].ata);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer]), "ConstraintTokenOwner");

    claim_reward(&mut env, &s, 0).unwrap();
    expect_anchor_error(claim_reward(&mut env, &s, 0), "AlreadyClaimed");
    expect_anchor_error(claim_refund(&mut env, &s, 0), "NothingToClaim");
    claim_reward(&mut env, &s, 1).unwrap();
    expect_anchor_error(claim_reward(&mut env, &s, 1), "AlreadyClaimed");
    assert_eq!(bal(&env, &s.players[1].ata), SHIELD + BUY_IN + 500_000);
    assert_fully_paid_out(&env, &s);
}

#[test]
fn undersubscribed_challenge_that_ran_cannot_settle_and_is_cancelled_instead() {
    let mut env = setup();
    let s = prepare(&mut env, 10, &[(ALL_VERIFIED, None), (ALL_VERIFIED, Some(1))], 0, |p| p.min_participants = 3);
    set_time(&mut env.svm, DISPUTE_END);
    finalize_all(&mut env, &s);
    expect_anchor_error(send(&mut env.svm, settle_ix(&s.challenge), &[&env.relayer]), "BelowMinimumParticipants");

    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    send(&mut env.svm, cancel_ix(&stranger.pubkey(), &s.challenge), &[&stranger]).unwrap();
    for i in 0..2 {
        claim_refund(&mut env, &s, i).unwrap();
        assert_eq!(bal(&env, &s.players[i].ata), START_BALANCE, "stake and any Shield back");
    }
    assert_fully_paid_out(&env, &s);
}
