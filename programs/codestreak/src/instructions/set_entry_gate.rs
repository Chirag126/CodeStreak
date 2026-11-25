use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::EntryGateUpdated;
use crate::state::{Config, EntryGate};

/// Admin-only. Sets (or clears with None) the key that must pay for, and so approve, every new
/// challenge, join and sponsorship. Applies immediately to all challenges, old and new. It can't
/// move funds and doesn't affect claims, refunds, finalizing, settling or Shields.
#[derive(Accounts)]
pub struct SetEntryGate<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ CodeStreakError::Unauthorized)]
    pub config: Account<'info, Config>,

    #[account(init_if_needed, payer = admin, space = 8 + EntryGate::INIT_SPACE, seeds = [ENTRY_GATE_SEED], bump)]
    pub entry_gate: Account<'info, EntryGate>,

    pub system_program: Program<'info, System>,
}

pub fn set_entry_gate_handler(ctx: Context<SetEntryGate>, authority: Option<Pubkey>) -> Result<()> {
    let gate = &mut ctx.accounts.entry_gate;
    gate.authority = authority;
    gate.bump = ctx.bumps.entry_gate;
    emit!(EntryGateUpdated { authority });
    Ok(())
}
