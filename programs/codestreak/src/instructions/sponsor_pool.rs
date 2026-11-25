use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::PoolSponsored;
use crate::instructions::shared::{check_entry_gate, check_join_authority, deposit_exact};
use crate::state::{Challenge, ChallengePhase, SponsorReceipt};

/// Anyone adds to a challenge's reward pool without participating. Allowed until the challenge
/// ends. The SponsorReceipt PDA accumulates this wallet's total as an on-chain receipt.
#[derive(Accounts)]
pub struct SponsorPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub sponsor: Signer<'info>,

    /// Required only for private challenges (private sponsor link checked by the relayer).
    pub join_authority: Option<Signer<'info>>,

    /// CHECK: the global entry gate PDA (address enforced by the seeds). Read in the handler: not
    /// created yet = open; otherwise the payer must be its authority (the CodeStreak relayer).
    #[account(seeds = [ENTRY_GATE_SEED], bump)]
    pub entry_gate: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [CHALLENGE_SEED, challenge.creator.as_ref(), &challenge.challenge_id.to_le_bytes()],
        bump = challenge.bump
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + SponsorReceipt::INIT_SPACE,
        seeds = [SPONSOR_SEED, challenge.key().as_ref(), sponsor.key().as_ref()],
        bump
    )]
    pub receipt: Box<Account<'info, SponsorReceipt>>,

    #[account(address = challenge.mint @ CodeStreakError::InvalidMint, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = mint, token::authority = sponsor, token::token_program = token_program)]
    pub sponsor_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = challenge.vault @ CodeStreakError::InvalidVault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = challenge.token_program @ CodeStreakError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

pub fn sponsor_pool_handler(ctx: Context<SponsorPool>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = ctx.accounts;

    require!(amount > 0, CodeStreakError::InvalidAmount);
    let phase = accounts.challenge.phase(now);
    require!(
        matches!(phase, ChallengePhase::Joining | ChallengePhase::Starting | ChallengePhase::Active),
        CodeStreakError::SponsorshipClosed
    );
    check_entry_gate(&accounts.entry_gate, &accounts.payer.key())?;
    check_join_authority(&accounts.challenge, &accounts.join_authority)?;

    deposit_exact(accounts.token_program.key(), &accounts.sponsor_token, &accounts.mint, &mut accounts.vault, &accounts.sponsor, amount)?;

    let receipt = &mut accounts.receipt;
    if receipt.contributions == 0 {
        // First contribution: the account was just created (init_if_needed).
        receipt.challenge = accounts.challenge.key();
        receipt.sponsor = accounts.sponsor.key();
        receipt.bump = ctx.bumps.receipt;
        receipt.first_at = now;
    }
    receipt.amount = receipt.amount.checked_add(amount).ok_or(CodeStreakError::MathOverflow)?;
    receipt.contributions = receipt.contributions.checked_add(1).ok_or(CodeStreakError::MathOverflow)?;
    receipt.last_at = now;

    let challenge = &mut accounts.challenge;
    challenge.total_sponsor = challenge.total_sponsor.checked_add(amount).ok_or(CodeStreakError::MathOverflow)?;

    emit!(PoolSponsored {
        challenge: challenge.key(),
        sponsor: receipt.sponsor,
        amount,
        sponsor_total: receipt.amount,
        pool_total_sponsor: challenge.total_sponsor,
    });
    Ok(())
}
