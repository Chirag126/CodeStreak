use anchor_lang::prelude::*;
use anchor_spl::token_2022::{set_authority, SetAuthority, Token2022};
use anchor_spl::token_interface::spl_token_2022::instruction::AuthorityType;
use anchor_spl::token_interface::Mint;

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::state::Participant;

/// Phase 37.3, for badges minted before mint_badge removed the authorities itself: removes the badge
/// mint's mint and freeze authority (both are the program's badge PDA on those mints), so wallets
/// see it as an NFT. Permissionless and harmless: it can only take authority away, it moves no
/// tokens, and a badge already sealed is left as it is.
#[derive(Accounts)]
pub struct SealBadge<'info> {
    /// The player record the badge belongs to (owner and type checked by Anchor).
    pub participant: Box<Account<'info, Participant>>,

    #[account(mut, seeds = [BADGE_MINT_SEED, participant.key().as_ref()], bump, mint::token_program = token_program)]
    pub badge_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: program-wide PDA that holds the badge authorities; holds no data.
    #[account(seeds = [BADGE_AUTHORITY_SEED], bump)]
    pub badge_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
}

pub fn seal_badge_handler(ctx: Context<SealBadge>) -> Result<()> {
    let a = &ctx.accounts;
    // A badge is exactly one token; anything else is not a badge mint we created.
    require!(a.badge_mint.supply == 1 && a.badge_mint.decimals == 0, CodeStreakError::NotABadge);
    let authority_seeds: &[&[u8]] = &[BADGE_AUTHORITY_SEED, &[ctx.bumps.badge_authority]];
    let token = a.token_program.key();
    for (kind, current) in [(AuthorityType::MintTokens, a.badge_mint.mint_authority), (AuthorityType::FreezeAccount, a.badge_mint.freeze_authority)] {
        if Option::<Pubkey>::from(current) == Some(a.badge_authority.key()) {
            set_authority(
                CpiContext::new_with_signer(
                    token,
                    SetAuthority { current_authority: a.badge_authority.to_account_info(), account_or_mint: a.badge_mint.to_account_info() },
                    &[authority_seeds],
                ),
                kind,
                None,
            )?;
        }
    }
    Ok(())
}
