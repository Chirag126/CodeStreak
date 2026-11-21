use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::ChallengeSettled;
use crate::rules::compute_settlement;
use crate::state::{Challenge, ChallengePhase, PoolState};

/// Permissionless: after every participant is finalized, fixes the payout split. Moves no funds;
/// each wallet then pulls its own payout with a claim instruction.
#[derive(Accounts)]
pub struct SettleChallenge<'info> {
    #[account(
        mut,
        seeds = [CHALLENGE_SEED, challenge.creator.as_ref(), &challenge.challenge_id.to_le_bytes()],
        bump = challenge.bump
    )]
    pub challenge: Box<Account<'info, Challenge>>,
}

pub fn settle_challenge_handler(ctx: Context<SettleChallenge>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let challenge = &mut ctx.accounts.challenge;

    match challenge.state {
        PoolState::Cancelled => return err!(CodeStreakError::ChallengeCancelled),
        PoolState::Settled => return err!(CodeStreakError::AlreadySettled),
        PoolState::Open => {}
    }
    require!(challenge.phase(now) == ChallengePhase::AwaitingSettlement, CodeStreakError::TooEarly);
    require!(challenge.participant_count >= challenge.min_participants, CodeStreakError::BelowMinimumParticipants);
    require!(challenge.finalized_count == challenge.participant_count, CodeStreakError::NotAllFinalized);

    let s = compute_settlement(challenge)?;
    challenge.state = PoolState::Settled;
    challenge.settled_at = now;
    challenge.full_refund = s.full_refund;
    challenge.reward_pool = s.reward_pool;
    challenge.reward_per_survivor = s.reward_per_survivor;
    challenge.reward_dust = s.reward_dust;

    emit!(ChallengeSettled {
        challenge: challenge.key(),
        survivors: challenge.survivor_count,
        failed: challenge.failed_count,
        voided: challenge.voided_count,
        full_refund: s.full_refund,
        reward_pool: s.reward_pool,
        reward_per_survivor: s.reward_per_survivor,
        reward_dust: s.reward_dust,
    });
    Ok(())
}
