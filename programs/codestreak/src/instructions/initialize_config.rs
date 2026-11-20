use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::ConfigInitialized;
use crate::program::Codestreak;
use crate::state::Config;

/// One-time global setup. Only the program's upgrade authority (the deploy key) can run it,
/// so nobody can claim admin rights between deployment and initialization.
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,

    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ CodeStreakError::Unauthorized)]
    pub program: Program<'info, Codestreak>,

    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ CodeStreakError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

pub fn validate_mints(mints: &[Pubkey]) -> Result<()> {
    require!(mints.len() <= MAX_ALLOWED_MINTS, CodeStreakError::TooManyMints);
    for (i, m) in mints.iter().enumerate() {
        require!(!mints[..i].contains(m), CodeStreakError::DuplicateMint);
    }
    Ok(())
}

pub fn initialize_config_handler(ctx: Context<InitializeConfig>, admin: Pubkey, default_verifier: Pubkey, allowed_mints: Vec<Pubkey>) -> Result<()> {
    validate_mints(&allowed_mints)?;
    let config = &mut ctx.accounts.config;
    config.admin = admin;
    config.default_verifier = default_verifier;
    config.allowed_mints = allowed_mints;
    config.bump = ctx.bumps.config;

    emit!(ConfigInitialized {
        admin,
        default_verifier,
        allowed_mints: config.allowed_mints.clone(),
    });
    Ok(())
}
