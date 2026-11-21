use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::ShieldActivated;
use crate::instructions::shared::deposit_exact;
use crate::rules::check_shield;
use crate::state::{Challenge, Participant};

/// A participant pays `shield_price` into the vault to protect one day. Shield payments join the
/// reward pool (Phase 8), so a Shield is never free money for anyone.
#[derive(Accounts)]
pub struct ActivateShield<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [CHALLENGE_SEED, challenge.creator.as_ref(), &challenge.challenge_id.to_le_bytes()],
        bump = challenge.bump
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    /// Seeds bind it to this challenge and this user: nobody can shield (or pay for) someone else.
    #[account(
        mut,
        seeds = [PARTICIPANT_SEED, challenge.key().as_ref(), user.key().as_ref()],
        bump = participant.bump
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
}

pub fn activate_shield_handler(ctx: Context<ActivateShield>, day: u16) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = ctx.accounts;

    check_shield(&accounts.challenge, &accounts.participant, day, now)?;

    let price = accounts.challenge.shield_price;
    deposit_exact(accounts.token_program.key(), &accounts.user_token, &accounts.mint, &mut accounts.vault, &accounts.user, price)?;

    let participant = &mut accounts.participant;
    participant.set_shielded(day);
    participant.shields_used = participant.shields_used.checked_add(1).ok_or(CodeStreakError::MathOverflow)?;
    participant.shield_paid = participant.shield_paid.checked_add(price).ok_or(CodeStreakError::MathOverflow)?;

    let challenge = &mut accounts.challenge;
    challenge.total_shield = challenge.total_shield.checked_add(price).ok_or(CodeStreakError::MathOverflow)?;

    emit!(ShieldActivated {
        challenge: challenge.key(),
        participant: participant.key(),
        user: participant.user,
        day,
        price,
        shields_used: participant.shields_used,
        total_shield: challenge.total_shield,
    });
    Ok(())
}
