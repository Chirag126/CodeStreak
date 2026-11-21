use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::ParticipantFinalized;
use crate::rules::participant_outcome;
use crate::state::{Challenge, ChallengePhase, Participant, ParticipantStatus, PoolState};

/// Permissionless: once the dispute window has closed, anyone (normally the worker) fixes a
/// participant's outcome from their recorded days. Moves no funds.
#[derive(Accounts)]
pub struct FinalizeParticipant<'info> {
    #[account(
        mut,
        seeds = [CHALLENGE_SEED, challenge.creator.as_ref(), &challenge.challenge_id.to_le_bytes()],
        bump = challenge.bump
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    #[account(
        mut,
        seeds = [PARTICIPANT_SEED, challenge.key().as_ref(), participant.user.as_ref()],
        bump = participant.bump,
        has_one = challenge @ CodeStreakError::ParticipantMismatch
    )]
    pub participant: Box<Account<'info, Participant>>,
}

pub fn finalize_participant_handler(ctx: Context<FinalizeParticipant>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let challenge = &mut ctx.accounts.challenge;
    let participant = &mut ctx.accounts.participant;

    match challenge.state {
        PoolState::Cancelled => return err!(CodeStreakError::ChallengeCancelled),
        PoolState::Settled => return err!(CodeStreakError::AlreadySettled),
        PoolState::Open => {}
    }
    require!(challenge.phase(now) == ChallengePhase::AwaitingSettlement, CodeStreakError::TooEarly);
    require!(!participant.finalized, CodeStreakError::AlreadyFinalized);

    let status = participant_outcome(challenge.num_days, participant);
    participant.status = status;
    participant.finalized = true;

    let bump = |n: u16| n.checked_add(1).ok_or(CodeStreakError::MathOverflow);
    challenge.finalized_count = bump(challenge.finalized_count)?;
    match status {
        ParticipantStatus::Survived => challenge.survivor_count = bump(challenge.survivor_count)?,
        ParticipantStatus::Failed => challenge.failed_count = bump(challenge.failed_count)?,
        ParticipantStatus::Voided => challenge.voided_count = bump(challenge.voided_count)?,
        ParticipantStatus::Active => unreachable!("participant_outcome never returns Active"),
    }

    emit!(ParticipantFinalized {
        challenge: challenge.key(),
        participant: participant.key(),
        user: participant.user,
        status,
        finalized_count: challenge.finalized_count,
    });
    Ok(())
}
