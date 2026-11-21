use anchor_lang::prelude::*;

use crate::constants::SECONDS_PER_DAY;

/// Only these states are stored. Everything between Open and settlement is derived from the
/// clock (see `Challenge::phase`), so no transaction is needed to move a challenge forward.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PoolState {
    Open,
    Cancelled,
    Settled,
}

/// Lifecycle as seen at a given time.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ChallengePhase {
    /// Before the join deadline: participants can join, anyone can sponsor.
    Joining,
    /// Join deadline passed, challenge not started yet.
    Starting,
    /// Days are running: daily verification happens.
    Active,
    /// Last day ended: the verifier finalizes remaining days.
    Verifying,
    /// Results can still be corrected upward (Failed -> Verified) after disputes.
    DisputeWindow,
    /// All windows closed: anyone can finalize participants and settle.
    AwaitingSettlement,
    Settled,
    Cancelled,
}

/// One challenge pool. PDA seeds: ["challenge", creator, challenge_id (u64 LE)].
#[account]
#[derive(InitSpace)]
pub struct Challenge {
    pub version: u8,
    pub bump: u8,
    pub vault_bump: u8,

    pub creator: Pubkey,
    pub challenge_id: u64,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub token_program: Pubkey,
    /// Fixed at creation from Config.default_verifier.
    pub verifier: Pubkey,
    /// Set for private groups: joining requires this key's co-signature.
    pub join_authority: Option<Pubkey>,

    /// Base units of `mint` (never floats).
    pub buy_in: u64,
    pub start_ts: i64,
    pub day_length_secs: u32,
    pub num_days: u16,
    pub join_deadline_ts: i64,
    pub min_participants: u16,
    pub max_participants: u16,

    pub shield_price: u64,
    pub max_shields_per_participant: u8,
    pub shield_grace_secs: u32,

    pub verify_window_secs: u32,
    pub dispute_window_secs: u32,

    /// SHA-256 of the off-chain rules JSON (providers, thresholds), published with the challenge.
    pub rules_hash: [u8; 32],
    /// True when day_length_secs < one day: the UI must label it as a compressed-time demo.
    pub is_demo: bool,

    pub state: PoolState,
    pub created_at: i64,

    // Counters (updated by later instructions).
    pub participant_count: u16,
    pub finalized_count: u16,
    pub survivor_count: u16,
    pub failed_count: u16,
    pub voided_count: u16,
    pub claimed_count: u16,
    pub total_stake: u64,
    pub total_sponsor: u64,
    pub total_shield: u64,
    pub total_paid_out: u64,
}

impl Challenge {
    pub const VERSION: u8 = 1;

    pub fn end_ts(&self) -> Option<i64> {
        let len = i64::from(self.num_days).checked_mul(i64::from(self.day_length_secs))?;
        self.start_ts.checked_add(len)
    }

    pub fn verify_end_ts(&self) -> Option<i64> {
        self.end_ts()?.checked_add(i64::from(self.verify_window_secs))
    }

    pub fn dispute_end_ts(&self) -> Option<i64> {
        self.verify_end_ts()?.checked_add(i64::from(self.dispute_window_secs))
    }

    /// Start of challenge day `day` (0-based). None if out of range.
    pub fn day_start_ts(&self, day: u16) -> Option<i64> {
        if day >= self.num_days {
            return None;
        }
        self.start_ts.checked_add(i64::from(day).checked_mul(i64::from(self.day_length_secs))?)
    }

    /// End (exclusive) of challenge day `day`.
    pub fn day_end_ts(&self, day: u16) -> Option<i64> {
        self.day_start_ts(day)?.checked_add(i64::from(self.day_length_secs))
    }

    pub fn shields_enabled(&self) -> bool {
        self.max_shields_per_participant > 0 && self.shield_price > 0
    }

    pub fn is_private(&self) -> bool {
        self.join_authority.is_some()
    }

    /// Lifecycle phase at `now` (unix seconds).
    pub fn phase(&self, now: i64) -> ChallengePhase {
        match self.state {
            PoolState::Cancelled => return ChallengePhase::Cancelled,
            PoolState::Settled => return ChallengePhase::Settled,
            PoolState::Open => {}
        }
        // Times were validated with checked math at creation, so these cannot overflow.
        let end = self.end_ts().unwrap_or(i64::MAX);
        let verify_end = self.verify_end_ts().unwrap_or(i64::MAX);
        let dispute_end = self.dispute_end_ts().unwrap_or(i64::MAX);
        if now < self.join_deadline_ts {
            ChallengePhase::Joining
        } else if now < self.start_ts {
            ChallengePhase::Starting
        } else if now < end {
            ChallengePhase::Active
        } else if now < verify_end {
            ChallengePhase::Verifying
        } else if now < dispute_end {
            ChallengePhase::DisputeWindow
        } else {
            ChallengePhase::AwaitingSettlement
        }
    }

    /// Challenge day containing `now`; None outside the active period.
    pub fn day_index(&self, now: i64) -> Option<u16> {
        if now < self.start_ts || now >= self.end_ts()? {
            return None;
        }
        u16::try_from((now - self.start_ts) / i64::from(self.day_length_secs)).ok()
    }

    pub fn is_real_time(&self) -> bool {
        self.day_length_secs == SECONDS_PER_DAY
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(state: PoolState) -> Challenge {
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
            buy_in: 10_000_000,
            start_ts: 1_000,
            day_length_secs: 100,
            num_days: 3,
            join_deadline_ts: 900,
            min_participants: 2,
            max_participants: 10,
            shield_price: 0,
            max_shields_per_participant: 0,
            shield_grace_secs: 0,
            verify_window_secs: 60,
            dispute_window_secs: 120,
            rules_hash: [0; 32],
            is_demo: true,
            state,
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

    #[test]
    fn phases_follow_the_clock() {
        let c = sample(PoolState::Open);
        assert_eq!(c.end_ts(), Some(1_300));
        assert_eq!(c.phase(0), ChallengePhase::Joining);
        assert_eq!(c.phase(899), ChallengePhase::Joining);
        assert_eq!(c.phase(900), ChallengePhase::Starting);
        assert_eq!(c.phase(1_000), ChallengePhase::Active);
        assert_eq!(c.phase(1_299), ChallengePhase::Active);
        assert_eq!(c.phase(1_300), ChallengePhase::Verifying);
        assert_eq!(c.phase(1_360), ChallengePhase::DisputeWindow);
        assert_eq!(c.phase(1_480), ChallengePhase::AwaitingSettlement);
    }

    #[test]
    fn stored_states_win_over_the_clock() {
        assert_eq!(sample(PoolState::Cancelled).phase(1_000), ChallengePhase::Cancelled);
        assert_eq!(sample(PoolState::Settled).phase(0), ChallengePhase::Settled);
    }

    #[test]
    fn day_index() {
        let c = sample(PoolState::Open);
        assert_eq!(c.day_index(999), None);
        assert_eq!(c.day_index(1_000), Some(0));
        assert_eq!(c.day_index(1_199), Some(1));
        assert_eq!(c.day_index(1_299), Some(2));
        assert_eq!(c.day_index(1_300), None);
    }
}
