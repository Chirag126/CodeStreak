use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::DayRecorded;
use crate::rules::{check_record_time, check_transition};
use crate::state::{Challenge, DayResult, Participant};

/// The challenge's verifier (the worker's key, fixed per challenge at creation) records one
/// participant-day. It signs and pays its own fee; it never touches funds.
#[derive(Accounts)]
pub struct RecordVerification<'info> {
    pub verifier: Signer<'info>,

    #[account(constraint = challenge.verifier == verifier.key() @ CodeStreakError::NotVerifier)]
    pub challenge: Box<Account<'info, Challenge>>,

    #[account(
        mut,
        seeds = [PARTICIPANT_SEED, challenge.key().as_ref(), participant.user.as_ref()],
        bump = participant.bump,
        has_one = challenge @ CodeStreakError::ParticipantMismatch
    )]
    pub participant: Box<Account<'info, Participant>>,
}

pub fn record_verification_handler(
    ctx: Context<RecordVerification>,
    day: u16,
    result: DayResult,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let challenge = &ctx.accounts.challenge;
    let participant = &mut ctx.accounts.participant;

    require!(day < challenge.num_days, CodeStreakError::InvalidDay);
    require!(!participant.finalized, CodeStreakError::AlreadyFinalized);
    let previous = participant.day_result(day);
    let upgraded = check_transition(previous, result)?;
    check_record_time(challenge, day, now, upgraded)?;

    participant.set_day_result(day, result);

    emit!(DayRecorded {
        challenge: challenge.key(),
        participant: participant.key(),
        user: participant.user,
        day,
        result,
        previous,
        upgraded,
        evidence_hash,
    });
    Ok(())
}
