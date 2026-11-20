use anchor_lang::prelude::*;

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
