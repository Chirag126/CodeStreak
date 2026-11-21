use anchor_lang::prelude::*;

use crate::constants::*;
use crate::events::ChallengeCancelled;
use crate::rules::check_cancel;
use crate::state::{Challenge, PoolState};

/// Cancels a challenge: by its creator before it starts, or by anyone once joining closed with
/// fewer than the minimum participants. Afterwards everyone claims a full refund.
#[derive(Accounts)]
pub struct CancelPool<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CHALLENGE_SEED, challenge.creator.as_ref(), &challenge.challenge_id.to_le_bytes()],
        bump = challenge.bump
    )]
    pub challenge: Box<Account<'info, Challenge>>,
}

pub fn cancel_pool_handler(ctx: Context<CancelPool>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let authority = ctx.accounts.authority.key();
    let challenge = &mut ctx.accounts.challenge;
    check_cancel(challenge, authority == challenge.creator, now)?;

    challenge.state = PoolState::Cancelled;
    challenge.cancelled_at = now;
    emit!(ChallengeCancelled { challenge: challenge.key(), cancelled_by: authority, participant_count: challenge.participant_count });
    Ok(())
}
