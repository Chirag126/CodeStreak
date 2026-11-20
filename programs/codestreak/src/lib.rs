//! CodeStreak on-chain program.
//!
//! Phase 3 scaffold: proves the Anchor workspace builds. Phase 5 onward adds the escrow
//! (config, pools, vaults), verification records, Shields, settlement and pull-based claims.
use anchor_lang::prelude::*;

// Placeholder id. After your first `anchor build`, run `anchor keys sync` to replace it
// (here and in Anchor.toml) with the id of target/deploy/codestreak-keypair.json.
declare_id!("A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J");

#[program]
pub mod codestreak {
    use super::*;

    /// Health-check instruction: logs the program version. Requires no accounts.
    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("CodeStreak program v{}", env!("CARGO_PKG_VERSION"));
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}
