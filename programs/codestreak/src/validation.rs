//! Pure validation of challenge parameters (no accounts), unit-tested on the host.
use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::CodeStreakError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializePoolParams {
    /// Chosen by the creator; together with the creator it determines the challenge address.
    pub challenge_id: u64,
    /// Base units of the challenge mint.
    pub buy_in: u64,
    pub start_ts: i64,
    /// 86_400 for real challenges; 60..86_399 marks a compressed-time demo challenge.
    pub day_length_secs: u32,
    pub num_days: u16,
    pub join_deadline_ts: i64,
    pub min_participants: u16,
    pub max_participants: u16,
    /// Base units; 0 when Shields are disabled.
    pub shield_price: u64,
    pub max_shields_per_participant: u8,
    /// How long after a day ends a Shield can still be activated for it.
    pub shield_grace_secs: u32,
    pub verify_window_secs: u32,
    pub dispute_window_secs: u32,
    /// Private groups: joining requires this key's co-signature.
    pub join_authority: Option<Pubkey>,
    pub rules_hash: [u8; 32],
}

/// Validates parameters at time `now`. Returns the challenge end time.
pub fn validate_pool_params(p: &InitializePoolParams, now: i64) -> std::result::Result<i64, CodeStreakError> {
    if p.buy_in == 0 {
        return Err(CodeStreakError::InvalidBuyIn);
    }
    if p.day_length_secs < MIN_DAY_LENGTH_SECS || p.day_length_secs > SECONDS_PER_DAY {
        return Err(CodeStreakError::InvalidDayLength);
    }
    if p.num_days == 0 || p.num_days > MAX_NUM_DAYS {
        return Err(CodeStreakError::InvalidNumDays);
    }
    if p.start_ts <= now {
        return Err(CodeStreakError::StartInPast);
    }
    if p.start_ts - now > MAX_START_DELAY_SECS {
        return Err(CodeStreakError::StartTooFar);
    }
    if p.join_deadline_ts <= now || p.join_deadline_ts > p.start_ts {
        return Err(CodeStreakError::InvalidJoinDeadline);
    }
    if p.min_participants < MIN_PARTICIPANTS || p.max_participants < p.min_participants || p.max_participants > MAX_PARTICIPANTS {
        return Err(CodeStreakError::InvalidParticipantLimits);
    }
    for w in [p.verify_window_secs, p.dispute_window_secs] {
        if !(MIN_WINDOW_SECS..=MAX_WINDOW_SECS).contains(&w) {
            return Err(CodeStreakError::InvalidWindow);
        }
    }
    let shields_on = p.max_shields_per_participant > 0;
    if p.max_shields_per_participant > MAX_SHIELDS_PER_PARTICIPANT
        || (shields_on && (p.shield_price == 0 || p.shield_grace_secs > p.day_length_secs))
        || (!shields_on && (p.shield_price != 0 || p.shield_grace_secs != 0))
    {
        return Err(CodeStreakError::InvalidShieldConfig);
    }

    let duration = i64::from(p.num_days)
        .checked_mul(i64::from(p.day_length_secs))
        .ok_or(CodeStreakError::MathOverflow)?;
    let end = p.start_ts.checked_add(duration).ok_or(CodeStreakError::MathOverflow)?;
    end.checked_add(i64::from(p.verify_window_secs))
        .and_then(|t| t.checked_add(i64::from(p.dispute_window_secs)))
        .ok_or(CodeStreakError::MathOverflow)?;
    Ok(end)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    fn valid() -> InitializePoolParams {
        InitializePoolParams {
            challenge_id: 1,
            buy_in: 10_000_000,
            start_ts: NOW + 3_600,
            day_length_secs: SECONDS_PER_DAY,
            num_days: 7,
            join_deadline_ts: NOW + 3_000,
            min_participants: 2,
            max_participants: 50,
            shield_price: 2_000_000,
            max_shields_per_participant: 1,
            shield_grace_secs: 7_200,
            verify_window_secs: 6 * 3_600,
            dispute_window_secs: 24 * 3_600,
            join_authority: None,
            rules_hash: [7; 32],
        }
    }

    fn err(f: impl FnOnce(&mut InitializePoolParams)) -> CodeStreakError {
        let mut p = valid();
        f(&mut p);
        validate_pool_params(&p, NOW).expect_err("expected an error")
    }

    #[test]
    fn valid_params_return_end_time() {
        assert_eq!(validate_pool_params(&valid(), NOW).unwrap(), NOW + 3_600 + 7 * 86_400);
    }

    #[test]
    fn demo_challenge_with_short_days_is_valid() {
        let mut p = valid();
        p.day_length_secs = 300;
        p.shield_grace_secs = 60;
        assert!(validate_pool_params(&p, NOW).is_ok());
    }

    #[test]
    fn rejects_bad_params() {
        assert!(matches!(err(|p| p.buy_in = 0), CodeStreakError::InvalidBuyIn));
        assert!(matches!(err(|p| p.day_length_secs = 59), CodeStreakError::InvalidDayLength));
        assert!(matches!(err(|p| p.day_length_secs = 86_401), CodeStreakError::InvalidDayLength));
        assert!(matches!(err(|p| p.num_days = 0), CodeStreakError::InvalidNumDays));
        assert!(matches!(err(|p| p.num_days = 61), CodeStreakError::InvalidNumDays));
        assert!(matches!(err(|p| p.start_ts = NOW), CodeStreakError::StartInPast));
        assert!(matches!(err(|p| p.start_ts = NOW - 1), CodeStreakError::StartInPast));
        assert!(matches!(err(|p| p.start_ts = NOW + 91 * 86_400), CodeStreakError::StartTooFar));
        assert!(matches!(err(|p| p.join_deadline_ts = p.start_ts + 1), CodeStreakError::InvalidJoinDeadline));
        assert!(matches!(err(|p| p.join_deadline_ts = NOW), CodeStreakError::InvalidJoinDeadline));
        assert!(matches!(err(|p| p.min_participants = 1), CodeStreakError::InvalidParticipantLimits));
        assert!(matches!(err(|p| p.max_participants = 1), CodeStreakError::InvalidParticipantLimits));
        assert!(matches!(err(|p| p.max_participants = 1_001), CodeStreakError::InvalidParticipantLimits));
        assert!(matches!(err(|p| p.verify_window_secs = 0), CodeStreakError::InvalidWindow));
        assert!(matches!(err(|p| p.dispute_window_secs = 8 * 86_400), CodeStreakError::InvalidWindow));
        assert!(matches!(err(|p| p.shield_price = 0), CodeStreakError::InvalidShieldConfig));
        assert!(matches!(err(|p| p.max_shields_per_participant = 4), CodeStreakError::InvalidShieldConfig));
        assert!(matches!(err(|p| p.shield_grace_secs = 86_401), CodeStreakError::InvalidShieldConfig));
        assert!(matches!(
            err(|p| {
                p.max_shields_per_participant = 0;
            }),
            CodeStreakError::InvalidShieldConfig
        ));
    }

    #[test]
    fn shields_can_be_disabled_cleanly() {
        let mut p = valid();
        p.max_shields_per_participant = 0;
        p.shield_price = 0;
        p.shield_grace_secs = 0;
        assert!(validate_pool_params(&p, NOW).is_ok());
    }
}
