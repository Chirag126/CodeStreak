//! Pure rules for recording results and activating Shields (host unit-tested).
use crate::errors::CodeStreakError;
use crate::state::{Challenge, DayResult, Participant, PoolState};

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
