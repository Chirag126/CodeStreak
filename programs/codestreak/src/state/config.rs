use anchor_lang::prelude::*;

use crate::constants::MAX_ALLOWED_MINTS;

/// Global settings, one per program. PDA seeds: ["config"].
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Manages allowed mints and the default verifier. Cannot move challenge funds.
    pub admin: Pubkey,
    /// Copied into each new challenge at creation; later changes never affect existing challenges.
    pub default_verifier: Pubkey,
    #[max_len(MAX_ALLOWED_MINTS)]
    pub allowed_mints: Vec<Pubkey>,
    pub bump: u8,
}

impl Config {
    pub fn is_mint_allowed(&self, mint: &Pubkey) -> bool {
        self.allowed_mints.iter().any(|m| m == mint)
    }
}
