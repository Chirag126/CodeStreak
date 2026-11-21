//! Pure rules for recording results and activating Shields (host unit-tested).
use crate::errors::CodeStreakError;
use crate::state::{Challenge, DayResult, Participant, ParticipantStatus, PoolState};

/// One-way rules. Returns `true` when the change is an upgrade of an earlier result.
/// - nothing recorded -> any result
/// - Failed or Indeterminate -> Verified (upgrade, e.g. after a dispute or late-arriving data)
/// - Verified -> anything: never (the verifier can't take a verified day away)
/// - anything else (Failed -> Failed, Failed <-> Indeterminate): rejected
pub fn check_transition(previous: Option<DayResult>, new: DayResult) -> Result<bool, CodeStreakError> {
    match (previous, new) {
        (None, _) => Ok(false),
        (Some(DayResult::Verified), _) => Err(CodeStreakError::VerifiedIsFinal),
        (Some(DayResult::Failed | DayResult::Indeterminate), DayResult::Verified) => Ok(true),
        _ => Err(CodeStreakError::InvalidTransition),
    }
}

/// When a result may be recorded for `day`:
/// - only after the day has ended;
/// - a first result until the verification window closes;
/// - an upgrade until the dispute window closes (never after: settlement relies on it).
pub fn check_record_time(c: &Challenge, day: u16, now: i64, is_upgrade: bool) -> Result<(), CodeStreakError> {
    if c.state != PoolState::Open {
        return Err(CodeStreakError::VerificationClosed);
    }
    let day_end = c.day_end_ts(day).ok_or(CodeStreakError::InvalidDay)?;
    if now < day_end {
        return Err(CodeStreakError::DayNotOver);
    }
    let deadline = if is_upgrade { c.dispute_end_ts() } else { c.verify_end_ts() }.ok_or(CodeStreakError::MathOverflow)?;
    if now >= deadline {
        return Err(CodeStreakError::VerificationClosed);
    }
    Ok(())
}

/// Whether `p` may activate a Shield for `day` at `now`. A Shield can be bought once the day has
/// started and until `shield_grace_secs` after it ends (so a missed day can be rescued).
pub fn check_shield(c: &Challenge, p: &Participant, day: u16, now: i64) -> Result<(), CodeStreakError> {
    if !c.shields_enabled() {
        return Err(CodeStreakError::ShieldsDisabled);
    }
    if c.state != PoolState::Open {
        return Err(CodeStreakError::ShieldWindowClosed);
    }
    if p.finalized {
        return Err(CodeStreakError::AlreadyFinalized);
    }
    let start = c.day_start_ts(day).ok_or(CodeStreakError::InvalidDay)?;
    let end = c.day_end_ts(day).ok_or(CodeStreakError::InvalidDay)?;
    if now < start {
        return Err(CodeStreakError::DayNotStarted);
    }
    let grace_end = end.checked_add(i64::from(c.shield_grace_secs)).ok_or(CodeStreakError::MathOverflow)?;
    if now >= grace_end {
        return Err(CodeStreakError::ShieldWindowClosed);
    }
    if p.is_shielded(day) {
        return Err(CodeStreakError::DayAlreadyShielded);
    }
    if p.day_result(day) == Some(DayResult::Verified) {
        return Err(CodeStreakError::DayAlreadyVerified);
    }
    if p.shields_used >= c.max_shields_per_participant {
        return Err(CodeStreakError::ShieldLimitReached);
    }
    Ok(())
}

/// Outcome of one participant once all windows have closed. A Shield covers its day whatever
/// was recorded. Any uncovered Failed day fails the challenge. Otherwise any uncovered day that is
/// Indeterminate or was never recorded voids it (stake back, no reward): a system problem never
/// costs a user their stake. Every day Verified or shielded: Survived.
pub fn participant_outcome(num_days: u16, p: &Participant) -> ParticipantStatus {
    let all_days = if num_days >= 64 { u64::MAX } else { (1u64 << num_days) - 1 };
    let uncovered_failures = p.failed_days & !p.shielded_days & all_days;
    let covered = (p.verified_days | p.shielded_days) & all_days;
    if uncovered_failures != 0 {
        ParticipantStatus::Failed
    } else if covered == all_days {
        ParticipantStatus::Survived
    } else {
        ParticipantStatus::Voided
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settlement {
    pub full_refund: bool,
    pub reward_pool: u64,
    pub reward_per_survivor: u64,
    pub reward_dust: u64,
}

/// Splits the pool once every participant is finalized.
/// - nobody survived: full refund for everyone (stakes, Shield payments, sponsorships);
/// - otherwise R = everything deposited minus the stakes returned to survivors and voided
///   participants (= forfeited stakes + sponsorships + Shields); each survivor gets their stake
///   plus floor(R / S); the remainder (dust, < S base units) goes to the last survivor to claim.
pub fn compute_settlement(c: &Challenge) -> Result<Settlement, CodeStreakError> {
    let survivors = u64::from(c.survivor_count);
    if survivors == 0 {
        return Ok(Settlement { full_refund: true, reward_pool: 0, reward_per_survivor: 0, reward_dust: 0 });
    }
    let deposited = c
        .total_stake
        .checked_add(c.total_sponsor)
        .and_then(|v| v.checked_add(c.total_shield))
        .ok_or(CodeStreakError::MathOverflow)?;
    let returned_stakes = survivors
        .checked_add(u64::from(c.voided_count))
        .and_then(|n| n.checked_mul(c.buy_in))
        .ok_or(CodeStreakError::MathOverflow)?;
    let reward_pool = deposited.checked_sub(returned_stakes).ok_or(CodeStreakError::MathOverflow)?;
    let reward_per_survivor = reward_pool / survivors;
    let reward_dust = reward_pool - reward_per_survivor * survivors;
    Ok(Settlement { full_refund: false, reward_pool, reward_per_survivor, reward_dust })
}

/// Reward for a survivor claiming now (stake + share, + dust if they are the last survivor).
pub fn reward_amount(c: &Challenge, p: &Participant) -> Result<u64, CodeStreakError> {
    if c.state != PoolState::Settled {
        return Err(if c.state == PoolState::Cancelled { CodeStreakError::ChallengeCancelled } else { CodeStreakError::NotSettled });
    }
    if p.claimed {
        return Err(CodeStreakError::AlreadyClaimed);
    }
    if c.full_refund || p.status != ParticipantStatus::Survived {
        return Err(CodeStreakError::NothingToClaim);
    }
    let is_last = c.survivors_claimed.checked_add(1) == Some(c.survivor_count);
    let dust = if is_last { c.reward_dust } else { 0 };
    p.deposited
        .checked_add(c.reward_per_survivor)
        .and_then(|v| v.checked_add(dust))
        .ok_or(CodeStreakError::MathOverflow)
}

/// Refund for a participant: everything back if the challenge was cancelled or nobody survived;
/// the stake if they were voided.
pub fn participant_refund_amount(c: &Challenge, p: &Participant) -> Result<u64, CodeStreakError> {
    let everything = || p.deposited.checked_add(p.shield_paid).ok_or(CodeStreakError::MathOverflow);
    let amount = match c.state {
        PoolState::Open => return Err(CodeStreakError::NotSettled),
        PoolState::Cancelled => everything()?,
        PoolState::Settled if c.full_refund => everything()?,
        PoolState::Settled if p.status == ParticipantStatus::Voided => p.deposited,
        PoolState::Settled => return Err(CodeStreakError::NothingToClaim),
    };
    if p.claimed {
        return Err(CodeStreakError::AlreadyClaimed);
    }
    Ok(amount)
}

/// Sponsors get their money back only if the challenge was cancelled or nobody survived;
/// otherwise it was paid out as rewards.
pub fn sponsor_refund_allowed(c: &Challenge) -> Result<(), CodeStreakError> {
    match c.state {
        PoolState::Open => Err(CodeStreakError::NotSettled),
        PoolState::Cancelled => Ok(()),
        PoolState::Settled if c.full_refund => Ok(()),
        PoolState::Settled => Err(CodeStreakError::NothingToClaim),
    }
}

/// Who may cancel, and when:
/// - the creator, any time before the challenge starts;
/// - anyone, once joining has closed with fewer than `min_participants`.
pub fn check_cancel(c: &Challenge, signer_is_creator: bool, now: i64) -> Result<(), CodeStreakError> {
    match c.state {
        PoolState::Open => {}
        PoolState::Cancelled => return Err(CodeStreakError::ChallengeCancelled),
        PoolState::Settled => return Err(CodeStreakError::AlreadySettled),
    }
    let creator_before_start = signer_is_creator && now < c.start_ts;
    let undersubscribed = now >= c.join_deadline_ts && c.participant_count < c.min_participants;
    if creator_before_start || undersubscribed {
        Ok(())
    } else {
        Err(CodeStreakError::CannotCancel)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::ParticipantStatus;
    use anchor_lang::prelude::Pubkey;
    use DayResult::*;

    // The generated error enum has no PartialEq: compare error codes.
    fn err<T: std::fmt::Debug>(r: Result<T, CodeStreakError>) -> u32 {
        r.unwrap_err() as u32
    }

    // start 1_000, 100-second days, 3 days -> end 1_300, verify end 1_400, dispute end 1_500.
    fn challenge() -> Challenge {
        Challenge {
            version: 1,
            bump: 255,
            vault_bump: 254,
            creator: Pubkey::default(),
            challenge_id: 1,
            mint: Pubkey::default(),
            vault: Pubkey::default(),
            token_program: Pubkey::default(),
            verifier: Pubkey::default(),
            join_authority: None,
            buy_in: 10,
            start_ts: 1_000,
            day_length_secs: 100,
            num_days: 3,
            join_deadline_ts: 900,
            min_participants: 2,
            max_participants: 10,
            shield_price: 5,
            max_shields_per_participant: 2,
            shield_grace_secs: 30,
            verify_window_secs: 100,
            dispute_window_secs: 100,
            rules_hash: [0; 32],
            is_demo: true,
            state: PoolState::Open,
            created_at: 0,
            participant_count: 0,
            finalized_count: 0,
            survivor_count: 0,
            failed_count: 0,
            voided_count: 0,
            claimed_count: 0,
            total_stake: 0,
            total_sponsor: 0,
            total_shield: 0,
            total_paid_out: 0,
            settled_at: 0,
            full_refund: false,
            reward_pool: 0,
            reward_per_survivor: 0,
            reward_dust: 0,
            survivors_claimed: 0,
            cancelled_at: 0,
        }
    }

    fn participant() -> Participant {
        Participant {
            challenge: Pubkey::default(),
            user: Pubkey::default(),
            bump: 255,
            joined_at: 0,
            deposited: 10,
            verified_days: 0,
            failed_days: 0,
            shielded_days: 0,
            shields_used: 0,
            shield_paid: 0,
            status: ParticipantStatus::Active,
            finalized: false,
            claimed: false,
            indeterminate_days: 0,
        }
    }

    #[test]
    fn outcomes() {
        use ParticipantStatus::*;
        let with = |v: u64, f: u64, i: u64, s: u64| {
            let mut p = participant();
            (p.verified_days, p.failed_days, p.indeterminate_days, p.shielded_days) = (v, f, i, s);
            participant_outcome(3, &p)
        };
        assert_eq!(with(0b111, 0, 0, 0), Survived);
        assert_eq!(with(0b101, 0b010, 0, 0b010), Survived, "Shield covers the failed day");
        assert_eq!(with(0b101, 0b010, 0, 0), Failed);
        assert_eq!(with(0b001, 0b010, 0b100, 0), Failed, "a failure beats an indeterminate day");
        assert_eq!(with(0b101, 0, 0b010, 0), Voided);
        assert_eq!(with(0b011, 0, 0, 0), Voided, "an unrecorded day voids, never fails");
        assert_eq!(with(0b011, 0, 0, 0b100), Survived, "a shielded unrecorded day is covered");
        assert_eq!(with(0b1111, 0b1000, 0, 0), Survived, "bits beyond num_days are ignored");
    }

    #[test]
    fn settlement_math() {
        let mut c = challenge();
        // 5 joined at 10; 2 survived, 1 voided, 2 failed; sponsors 7; Shields 4.
        (c.total_stake, c.total_sponsor, c.total_shield) = (50, 7, 4);
        (c.survivor_count, c.voided_count, c.failed_count) = (2, 1, 2);
        let s = compute_settlement(&c).unwrap();
        assert_eq!(s, Settlement { full_refund: false, reward_pool: 31, reward_per_survivor: 15, reward_dust: 1 });
        // Payouts add up exactly to everything deposited.
        assert_eq!(2 * (10 + 15) + 1 + 10, 50 + 7 + 4);

        c.survivor_count = 0;
        assert!(compute_settlement(&c).unwrap().full_refund);
    }

    #[test]
    fn payouts_and_dust_to_last_claimer() {
        let mut c = challenge();
        c.state = PoolState::Settled;
        (c.survivor_count, c.reward_per_survivor, c.reward_dust) = (2, 15, 1);
        let mut p = participant();
        p.status = ParticipantStatus::Survived;
        assert_eq!(reward_amount(&c, &p).unwrap(), 25);
        c.survivors_claimed = 1;
        assert_eq!(reward_amount(&c, &p).unwrap(), 26, "last survivor gets the dust");
        p.claimed = true;
        assert_eq!(err(reward_amount(&c, &p)), CodeStreakError::AlreadyClaimed as u32);

        let mut voided = participant();
        voided.status = ParticipantStatus::Voided;
        voided.shield_paid = 5;
        assert_eq!(err(reward_amount(&c, &voided)), CodeStreakError::NothingToClaim as u32);
        assert_eq!(participant_refund_amount(&c, &voided).unwrap(), 10, "voided: stake only");
        let mut failed = participant();
        failed.status = ParticipantStatus::Failed;
        assert_eq!(err(participant_refund_amount(&c, &failed)), CodeStreakError::NothingToClaim as u32);
        assert_eq!(err(sponsor_refund_allowed(&c)), CodeStreakError::NothingToClaim as u32);

        c.full_refund = true;
        assert_eq!(participant_refund_amount(&c, &failed).unwrap(), 10);
        assert_eq!(participant_refund_amount(&c, &voided).unwrap(), 15, "full refund includes Shields");
        assert!(sponsor_refund_allowed(&c).is_ok());

        let open = challenge();
        assert_eq!(err(reward_amount(&open, &p)), CodeStreakError::NotSettled as u32);
        assert_eq!(err(participant_refund_amount(&open, &voided)), CodeStreakError::NotSettled as u32);
    }

    #[test]
    fn cancel_rules() {
        let mut c = challenge(); // join deadline 900, start 1_000, min 2
        assert!(check_cancel(&c, true, 999).is_ok(), "creator before start");
        assert_eq!(err(check_cancel(&c, true, 1_000)), CodeStreakError::CannotCancel as u32);
        assert_eq!(err(check_cancel(&c, false, 500)), CodeStreakError::CannotCancel as u32);
        c.participant_count = 1;
        assert_eq!(err(check_cancel(&c, false, 899)), CodeStreakError::CannotCancel as u32);
        assert!(check_cancel(&c, false, 900).is_ok(), "anyone, once joining closed under minimum");
        assert!(check_cancel(&c, false, 5_000).is_ok());
        c.state = PoolState::Cancelled;
        assert_eq!(err(check_cancel(&c, true, 0)), CodeStreakError::ChallengeCancelled as u32);
    }

    #[test]
    fn transitions_are_one_way() {
        for r in [Verified, Failed, Indeterminate] {
            assert!(!check_transition(None, r).unwrap());
            assert_eq!(err(check_transition(Some(Verified), r)), CodeStreakError::VerifiedIsFinal as u32);
        }
        assert!(check_transition(Some(Failed), Verified).unwrap());
        assert!(check_transition(Some(Indeterminate), Verified).unwrap());
        for (prev, new) in [(Failed, Failed), (Failed, Indeterminate), (Indeterminate, Failed), (Indeterminate, Indeterminate)] {
            assert_eq!(err(check_transition(Some(prev), new)), CodeStreakError::InvalidTransition as u32);
        }
    }

    #[test]
    fn bitmaps_hold_exactly_one_result_per_day() {
        let mut p = participant();
        p.set_day_result(0, Verified);
        p.set_day_result(1, Failed);
        p.set_day_result(2, Indeterminate);
        assert_eq!((p.verified_days, p.failed_days, p.indeterminate_days), (0b001, 0b010, 0b100));
        p.set_day_result(1, Verified);
        assert_eq!((p.verified_days, p.failed_days), (0b011, 0b000));
        assert_eq!(p.day_result(1), Some(Verified));
        assert_eq!(p.day_result(59), None);
        p.set_day_result(59, Failed);
        assert_eq!(p.failed_days, 1u64 << 59);
    }

    #[test]
    fn record_time_windows() {
        let c = challenge();
        assert_eq!(err(check_record_time(&c, 0, 1_099, false)), CodeStreakError::DayNotOver as u32);
        assert!(check_record_time(&c, 0, 1_100, false).is_ok());
        assert_eq!(err(check_record_time(&c, 3, 2_000, false)), CodeStreakError::InvalidDay as u32);
        // First results: until verify end (1_400).
        assert!(check_record_time(&c, 2, 1_399, false).is_ok());
        assert_eq!(err(check_record_time(&c, 2, 1_400, false)), CodeStreakError::VerificationClosed as u32);
        // Upgrades: also inside the dispute window, until 1_500.
        assert!(check_record_time(&c, 2, 1_450, true).is_ok());
        assert_eq!(err(check_record_time(&c, 2, 1_500, true)), CodeStreakError::VerificationClosed as u32);
        let mut settled = challenge();
        settled.state = PoolState::Settled;
        assert_eq!(err(check_record_time(&settled, 0, 1_200, true)), CodeStreakError::VerificationClosed as u32);
    }

    #[test]
    fn shield_rules() {
        let c = challenge();
        let p = participant();
        assert_eq!(err(check_shield(&c, &p, 1, 1_099)), CodeStreakError::DayNotStarted as u32);
        assert!(check_shield(&c, &p, 1, 1_100).is_ok());
        assert!(check_shield(&c, &p, 1, 1_229).is_ok(), "inside grace");
        assert_eq!(err(check_shield(&c, &p, 1, 1_230)), CodeStreakError::ShieldWindowClosed as u32);
        assert_eq!(err(check_shield(&c, &p, 3, 1_250)), CodeStreakError::InvalidDay as u32);

        let mut used = participant();
        used.shields_used = 2;
        assert_eq!(err(check_shield(&c, &used, 1, 1_150)), CodeStreakError::ShieldLimitReached as u32);

        let mut shielded = participant();
        shielded.set_shielded(1);
        assert_eq!(err(check_shield(&c, &shielded, 1, 1_150)), CodeStreakError::DayAlreadyShielded as u32);

        let mut verified = participant();
        verified.set_day_result(1, Verified);
        assert_eq!(err(check_shield(&c, &verified, 1, 1_210)), CodeStreakError::DayAlreadyVerified as u32);

        let mut failed = participant();
        failed.set_day_result(1, Failed);
        assert!(check_shield(&c, &failed, 1, 1_210).is_ok(), "a failed day can be rescued within grace");

        let mut off = challenge();
        (off.max_shields_per_participant, off.shield_price, off.shield_grace_secs) = (0, 0, 0);
        assert_eq!(err(check_shield(&off, &p, 1, 1_150)), CodeStreakError::ShieldsDisabled as u32);
    }
}
