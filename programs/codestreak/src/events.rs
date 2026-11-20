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
