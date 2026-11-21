use anchor_lang::prelude::*;

/// Outcome after finalization (Phase 8). `Active` until then.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ParticipantStatus {
    Active,
    Survived,
    Failed,
    /// Indeterminate evidence, no failures: stake refunded, no reward share.
    Voided,
}

/// One user's membership in one challenge. PDA seeds: ["participant", challenge, user].
/// Created with `init`, so the same user can never join the same challenge twice.
#[account]
#[derive(InitSpace)]
pub struct Participant {
    pub challenge: Pubkey,
    pub user: Pubkey,
    pub bump: u8,
    pub joined_at: i64,
    /// Base units deposited (the buy-in).
    pub deposited: u64,
    /// Day bitmaps (bit i = challenge day i; max 60 days fits in u64). Written from Phase 7.
    pub verified_days: u64,
    pub failed_days: u64,
    pub shielded_days: u64,
    pub shields_used: u8,
    pub shield_paid: u64,
    pub status: ParticipantStatus,
    pub finalized: bool,
    pub claimed: bool,
    /// Days whose evidence could not be determined (e.g. provider outage). Appended in Phase 7.
    pub indeterminate_days: u64,
}

/// What the verifier recorded for one participant-day.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum DayResult {
    Verified,
    Failed,
    /// Evidence unavailable (provider outage, rate limit). Never counts as a failure: a challenge
    /// with an indeterminate day and no failures is voided for that participant (stake refunded).
    Indeterminate,
}

impl Participant {
    fn bit(day: u16) -> u64 {
        1u64 << day
    }

    /// Recorded result for `day` (< 64), if any.
    pub fn day_result(&self, day: u16) -> Option<DayResult> {
        let b = Self::bit(day);
        if self.verified_days & b != 0 {
            Some(DayResult::Verified)
        } else if self.failed_days & b != 0 {
            Some(DayResult::Failed)
        } else if self.indeterminate_days & b != 0 {
            Some(DayResult::Indeterminate)
        } else {
            None
        }
    }

    /// Stores `result` for `day`, clearing any previous result so exactly one bit is set.
    pub fn set_day_result(&mut self, day: u16, result: DayResult) {
        let b = Self::bit(day);
        self.verified_days &= !b;
        self.failed_days &= !b;
        self.indeterminate_days &= !b;
        match result {
            DayResult::Verified => self.verified_days |= b,
            DayResult::Failed => self.failed_days |= b,
            DayResult::Indeterminate => self.indeterminate_days |= b,
        }
    }

    pub fn is_shielded(&self, day: u16) -> bool {
        self.shielded_days & Self::bit(day) != 0
    }

    pub fn set_shielded(&mut self, day: u16) {
        self.shielded_days |= Self::bit(day);
    }
}
