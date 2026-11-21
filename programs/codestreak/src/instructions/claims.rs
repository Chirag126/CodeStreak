//! Pull-based payouts. Each instruction pays one wallet, once, into a token account that wallet
//! owns. They are permissionless to send (the worker can push payouts for users), but the money
//! can only ever go to its owner, and flags make every payout one-time.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::{PayoutClaimed, PayoutKind};
use crate::instructions::shared::pay_from_vault;
use crate::rules::{participant_refund_amount, reward_amount, sponsor_refund_allowed};
use crate::state::{Challenge, Participant, SponsorReceipt};

#[derive(Accounts)]
pub struct ClaimParticipant<'info> {
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

    #[account(address = challenge.mint @ CodeStreakError::InvalidMint, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// Must be owned by the participant's wallet.
    #[account(mut, token::mint = mint, token::authority = participant.user, token::token_program = token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = challenge.vault @ CodeStreakError::InvalidVault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = challenge.token_program @ CodeStreakError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimSponsorRefund<'info> {
    #[account(
        mut,
        seeds = [CHALLENGE_SEED, challenge.creator.as_ref(), &challenge.challenge_id.to_le_bytes()],
        bump = challenge.bump
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    #[account(
        mut,
        seeds = [SPONSOR_SEED, challenge.key().as_ref(), receipt.sponsor.as_ref()],
        bump = receipt.bump,
        has_one = challenge @ CodeStreakError::ParticipantMismatch
    )]
    pub receipt: Box<Account<'info, SponsorReceipt>>,

    #[account(address = challenge.mint @ CodeStreakError::InvalidMint, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// Must be owned by the sponsor's wallet.
    #[account(mut, token::mint = mint, token::authority = receipt.sponsor, token::token_program = token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = challenge.vault @ CodeStreakError::InvalidVault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = challenge.token_program @ CodeStreakError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
}

fn record_payout(challenge: &mut Challenge, amount: u64) -> Result<()> {
    challenge.claimed_count = challenge.claimed_count.checked_add(1).ok_or(CodeStreakError::MathOverflow)?;
    challenge.total_paid_out = challenge.total_paid_out.checked_add(amount).ok_or(CodeStreakError::MathOverflow)?;
    Ok(())
}

/// Survivor: stake + floor(R / survivors), plus the dust if they are the last survivor to claim.
pub fn claim_reward_handler(ctx: Context<ClaimParticipant>) -> Result<()> {
    let a = ctx.accounts;
    let amount = reward_amount(&a.challenge, &a.participant)?;
    a.participant.claimed = true;
    pay_from_vault(&a.challenge, a.token_program.key(), &a.vault, &a.mint, &a.destination, amount)?;

    let challenge = &mut a.challenge;
    challenge.survivors_claimed = challenge.survivors_claimed.checked_add(1).ok_or(CodeStreakError::MathOverflow)?;
    record_payout(challenge, amount)?;
    emit!(PayoutClaimed {
        challenge: challenge.key(),
        owner: a.participant.user,
        kind: PayoutKind::Reward,
        amount,
        total_paid_out: challenge.total_paid_out,
    });
    Ok(())
}

/// Participant refund: everything (stake + Shields) if cancelled or nobody survived; stake if voided.
pub fn claim_refund_handler(ctx: Context<ClaimParticipant>) -> Result<()> {
    let a = ctx.accounts;
    let amount = participant_refund_amount(&a.challenge, &a.participant)?;
    a.participant.claimed = true;
    pay_from_vault(&a.challenge, a.token_program.key(), &a.vault, &a.mint, &a.destination, amount)?;

    let challenge = &mut a.challenge;
    record_payout(challenge, amount)?;
    emit!(PayoutClaimed {
        challenge: challenge.key(),
        owner: a.participant.user,
        kind: PayoutKind::ParticipantRefund,
        amount,
        total_paid_out: challenge.total_paid_out,
    });
    Ok(())
}

/// Sponsor refund: everything they sponsored, if the challenge was cancelled or nobody survived.
pub fn claim_sponsor_refund_handler(ctx: Context<ClaimSponsorRefund>) -> Result<()> {
    let a = ctx.accounts;
    sponsor_refund_allowed(&a.challenge)?;
    require!(!a.receipt.refunded, CodeStreakError::AlreadyClaimed);
    let amount = a.receipt.amount;
    a.receipt.refunded = true;
    pay_from_vault(&a.challenge, a.token_program.key(), &a.vault, &a.mint, &a.destination, amount)?;

    let challenge = &mut a.challenge;
    record_payout(challenge, amount)?;
    emit!(PayoutClaimed {
        challenge: challenge.key(),
        owner: a.receipt.sponsor,
        kind: PayoutKind::SponsorRefund,
        amount,
        total_paid_out: challenge.total_paid_out,
    });
    Ok(())
}
