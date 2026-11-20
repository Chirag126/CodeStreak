use anchor_lang::prelude::*;

/// On-chain receipt of everything one wallet sponsored to one challenge (accumulates).
/// PDA seeds: ["sponsor", challenge, sponsor].
#[account]
#[derive(InitSpace)]
pub struct SponsorReceipt {
    pub challenge: Pubkey,
    pub sponsor: Pubkey,
    pub bump: u8,
    /// Total base units sponsored by this wallet.
    pub amount: u64,
    pub contributions: u32,
    pub first_at: i64,
    pub last_at: i64,
    /// Set when a refund is claimed (cancelled challenge or no survivors, Phase 8).
    pub refunded: bool,
}
