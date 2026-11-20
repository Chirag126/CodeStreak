use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::ConfigUpdated;
use crate::instructions::initialize_config::validate_mints;
use crate::state::Config;

/// Admin-only. Affects challenges created afterwards; existing challenges keep their own copy
/// of the verifier, and their mint is fixed, so this can never touch existing pools.
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ CodeStreakError::Unauthorized)]
    pub config: Account<'info, Config>,
}

pub fn update_config_handler(
    ctx: Context<UpdateConfig>,
    new_admin: Option<Pubkey>,
    new_default_verifier: Option<Pubkey>,
    new_allowed_mints: Option<Vec<Pubkey>>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(mints) = new_allowed_mints {
        validate_mints(&mints)?;
        config.allowed_mints = mints;
    }
    if let Some(v) = new_default_verifier {
        config.default_verifier = v;
    }
    if let Some(a) = new_admin {
        config.admin = a;
    }

    emit!(ConfigUpdated {
        admin: config.admin,
        default_verifier: config.default_verifier,
        allowed_mints: config.allowed_mints.clone(),
    });
    Ok(())
}
