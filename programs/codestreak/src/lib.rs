//! CodeStreak: escrow, verification and settlement for coding-streak challenges (Solana devnet).
//!
//! Phase 5: global config (admin, default verifier, allowed mints) and challenge pools with a
//! program-owned token vault. Later phases add join/sponsor, verification records, Shields,
//! settlement and pull-based claims.
use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod validation;

use instructions::*;
pub use validation::InitializePoolParams;

declare_id!("A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J");

#[program]
pub mod codestreak {
    use super::*;

    /// One-time setup by the program's upgrade authority.
    pub fn initialize_config(ctx: Context<InitializeConfig>, admin: Pubkey, default_verifier: Pubkey, allowed_mints: Vec<Pubkey>) -> Result<()> {
        initialize_config_handler(ctx, admin, default_verifier, allowed_mints)
    }

    /// Admin-only changes for future challenges (allowed mints, default verifier, admin rotation).
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_admin: Option<Pubkey>,
        new_default_verifier: Option<Pubkey>,
        new_allowed_mints: Option<Vec<Pubkey>>,
    ) -> Result<()> {
        update_config_handler(ctx, new_admin, new_default_verifier, new_allowed_mints)
    }

    /// Creates a challenge pool and its program-owned vault.
    pub fn initialize_pool(ctx: Context<InitializePool>, params: InitializePoolParams) -> Result<()> {
        initialize_pool_handler(ctx, params)
    }
}
