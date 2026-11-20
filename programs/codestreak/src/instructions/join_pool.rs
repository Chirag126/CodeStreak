use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::ParticipantJoined;
use crate::instructions::shared::{check_join_authority, deposit_exact};
use crate::state::{Challenge, ChallengePhase, Participant, ParticipantStatus};

/// A user joins a challenge by depositing the buy-in into the vault.
/// `payer` (e.g. the relayer) pays the Participant account rent; `user` signs for the tokens.
#[derive(Accounts)]
pub struct JoinPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub user: Signer<'info>,

    /// Required only for private challenges.
    pub join_authority: Option<Signer<'info>>,

    #[account(
        mut,
        seeds = [CHALLENGE_SEED, challenge.creator.as_ref(), &challenge.challenge_id.to_le_bytes()],
        bump = challenge.bump
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    /// `init` makes a second join by the same user fail: the account already exists.
    #[account(
        init,
        payer = payer,
        space = 8 + Participant::INIT_SPACE,
        seeds = [PARTICIPANT_SEED, challenge.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub participant: Box<Account<'info, Participant>>,

    #[account(address = challenge.mint @ CodeStreakError::InvalidMint, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = mint, token::authority = user, token::token_program = token_program)]
    pub user_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = challenge.vault @ CodeStreakError::InvalidVault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = challenge.token_program @ CodeStreakError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

pub fn join_pool_handler(ctx: Context<JoinPool>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = ctx.accounts;
    let challenge = &accounts.challenge;

    require!(challenge.phase(now) == ChallengePhase::Joining, CodeStreakError::JoinClosed);
    check_join_authority(challenge, &accounts.join_authority)?;
    require!(challenge.participant_count < challenge.max_participants, CodeStreakError::PoolFull);

    let amount = challenge.buy_in;
    deposit_exact(accounts.token_program.key(), &accounts.user_token, &accounts.mint, &mut accounts.vault, &accounts.user, amount)?;

    let participant = &mut accounts.participant;
    participant.challenge = accounts.challenge.key();
    participant.user = accounts.user.key();
    participant.bump = ctx.bumps.participant;
    participant.joined_at = now;
    participant.deposited = amount;
    participant.status = ParticipantStatus::Active;
    // Bitmaps, shield fields and flags start zeroed / false.

    let challenge = &mut accounts.challenge;
    challenge.participant_count = challenge.participant_count.checked_add(1).ok_or(CodeStreakError::MathOverflow)?;
    challenge.total_stake = challenge.total_stake.checked_add(amount).ok_or(CodeStreakError::MathOverflow)?;

    emit!(ParticipantJoined {
        challenge: challenge.key(),
        user: participant.user,
        participant: participant.key(),
        amount,
        participant_count: challenge.participant_count,
        total_stake: challenge.total_stake,
    });
    Ok(())
}
