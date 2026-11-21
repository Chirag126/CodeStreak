//! Helpers shared by instructions that move tokens into a challenge vault.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked};

use crate::constants::CHALLENGE_SEED;
use crate::errors::CodeStreakError;
use crate::state::Challenge;

/// Private challenges require their join authority (the CodeStreak relayer, after it checked the
/// invite) to co-sign. Public challenges ignore the optional signer.
pub fn check_join_authority(challenge: &Challenge, join_authority: &Option<Signer>) -> Result<()> {
    if let Some(expected) = challenge.join_authority {
        let signer = join_authority.as_ref().ok_or(error!(CodeStreakError::JoinAuthorityRequired))?;
        require_keys_eq!(signer.key(), expected, CodeStreakError::InvalidJoinAuthority);
    }
    Ok(())
}

/// Moves `amount` from `from` (signed by `authority`) into the vault and verifies the vault grew by
/// exactly `amount`. Mints that take a transfer fee are rejected, so the vault always equals the
/// sum of recorded deposits.
pub fn deposit_exact<'info>(
    token_program: Pubkey,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    vault: &mut InterfaceAccount<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    let before = vault.amount;
    transfer_checked(
        CpiContext::new(
            token_program,
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: vault.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )?;
    vault.reload()?;
    let expected = before.checked_add(amount).ok_or(CodeStreakError::MathOverflow)?;
    require!(vault.amount == expected, CodeStreakError::TransferAmountMismatch);
    Ok(())
}

/// Pays `amount` from the challenge vault to `to`, signed by the challenge PDA (the vault's
/// authority). This is the only way funds leave a vault, and only claim/refund instructions call it.
pub fn pay_from_vault<'info>(
    challenge: &Account<'info, Challenge>,
    token_program: Pubkey,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let id = challenge.challenge_id.to_le_bytes();
    let bump = [challenge.bump];
    let seeds: &[&[u8]] = &[CHALLENGE_SEED, challenge.creator.as_ref(), &id, &bump];
    transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: challenge.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}
