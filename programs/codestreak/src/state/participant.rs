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
}
