use anchor_lang::prelude::*;

use crate::state::{DayResult, ParticipantStatus};

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub default_verifier: Pubkey,
    pub allowed_mints: Vec<Pubkey>,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub default_verifier: Pubkey,
    pub allowed_mints: Vec<Pubkey>,
}

#[event]
pub struct ParticipantJoined {
    pub challenge: Pubkey,
    pub user: Pubkey,
    pub participant: Pubkey,
    pub amount: u64,
    pub participant_count: u16,
    pub total_stake: u64,
}

#[event]
pub struct PoolSponsored {
    pub challenge: Pubkey,
    pub sponsor: Pubkey,
    pub amount: u64,
    /// Everything this wallet has sponsored to this challenge so far.
    pub sponsor_total: u64,
    /// Everything all sponsors have contributed to this challenge so far.
    pub pool_total_sponsor: u64,
}

#[event]
pub struct PoolCreated {
    pub challenge: Pubkey,
    pub creator: Pubkey,
    pub challenge_id: u64,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub buy_in: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub num_days: u16,
    pub day_length_secs: u32,
    pub is_private: bool,
    pub is_demo: bool,
}

#[event]
pub struct DayRecorded {
    pub challenge: Pubkey,
    pub participant: Pubkey,
    pub user: Pubkey,
    pub day: u16,
    pub result: DayResult,
    pub previous: Option<DayResult>,
    /// True for Failed/Indeterminate -> Verified.
    pub upgraded: bool,
    /// SHA-256 of the off-chain evidence (commit SHAs, submission IDs) kept in Supabase.
    pub evidence_hash: [u8; 32],
}

#[event]
pub struct ShieldActivated {
    pub challenge: Pubkey,
    pub participant: Pubkey,
    pub user: Pubkey,
    pub day: u16,
    pub price: u64,
    pub shields_used: u8,
    pub total_shield: u64,
}

#[event]
pub struct ParticipantFinalized {
    pub challenge: Pubkey,
    pub participant: Pubkey,
    pub user: Pubkey,
    pub status: ParticipantStatus,
    pub finalized_count: u16,
}

#[event]
pub struct ChallengeSettled {
    pub challenge: Pubkey,
    pub survivors: u16,
    pub failed: u16,
    pub voided: u16,
    pub full_refund: bool,
    pub reward_pool: u64,
    pub reward_per_survivor: u64,
    pub reward_dust: u64,
}

#[event]
pub struct ChallengeCancelled {
    pub challenge: Pubkey,
    pub cancelled_by: Pubkey,
    pub participant_count: u16,
}

#[event]
pub struct PayoutClaimed {
    pub challenge: Pubkey,
    /// The wallet that received the funds (participant or sponsor).
    pub owner: Pubkey,
    pub kind: PayoutKind,
    pub amount: u64,
    pub total_paid_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PayoutKind {
    Reward,
    ParticipantRefund,
    SponsorRefund,
}

#[event]
pub struct BadgeMinted {
    pub challenge: Pubkey,
    pub participant: Pubkey,
    pub user: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct EntryGateUpdated {
    pub authority: Option<Pubkey>,
}
