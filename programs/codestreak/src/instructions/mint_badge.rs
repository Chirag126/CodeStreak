use anchor_lang::prelude::*;
use anchor_lang::system_program::{allocate, assign, transfer, Allocate, Assign, Transfer};
use anchor_spl::associated_token::{self, AssociatedToken, Create};
use anchor_spl::token_2022::{initialize_mint2, mint_to, set_authority, InitializeMint2, MintTo, SetAuthority, Token2022};
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::TokenMetadata;
use anchor_spl::token_2022_extensions::{
    metadata_pointer_initialize, non_transferable_mint_initialize, token_metadata_initialize, MetadataPointerInitialize,
    NonTransferableMintInitialize, TokenMetadataInitialize,
};
use anchor_spl::token_interface::spl_token_2022::{extension::ExtensionType, instruction::AuthorityType, state::Mint as SplMint};

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::BadgeMinted;
use crate::state::{Challenge, Participant, ParticipantStatus};

/// Mints the soulbound survivor badge: a Token-2022 NFT (supply 1, 0 decimals, no mint or freeze
/// authority afterwards) with the NonTransferable extension and on-mint metadata, into the player's
/// own token account.
///
/// Gated by the chain, not by a server: only a finalized Survived participant qualifies. The mint
/// is a PDA of the participant (one badge per player per challenge, ever), its mint and metadata
/// authority is the program's badge PDA (its mint authority is removed right after the single
/// badge is minted, so nobody can mint more; nobody can rewrite the metadata), and name, symbol and
/// URI are fixed here (the payer can't choose them). Anyone may pay for it; it always goes to the
/// participant's own wallet.
#[derive(Accounts)]
pub struct MintBadge<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CHALLENGE_SEED, challenge.creator.as_ref(), &challenge.challenge_id.to_le_bytes()],
        bump = challenge.bump
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    #[account(
        seeds = [PARTICIPANT_SEED, challenge.key().as_ref(), participant.user.as_ref()],
        bump = participant.bump,
        constraint = participant.finalized && participant.status == ParticipantStatus::Survived @ CodeStreakError::NotSurvivor
    )]
    pub participant: Box<Account<'info, Participant>>,

    /// CHECK: the badge owner; must be the participant's wallet.
    #[account(address = participant.user)]
    pub user: UncheckedAccount<'info>,

    /// CHECK: created in this instruction (PDA of the participant); must still be empty.
    #[account(mut, seeds = [BADGE_MINT_SEED, participant.key().as_ref()], bump)]
    pub badge_mint: UncheckedAccount<'info>,

    /// CHECK: program-wide PDA that is the badge mint and metadata authority; holds no data.
    #[account(seeds = [BADGE_AUTHORITY_SEED], bump)]
    pub badge_authority: UncheckedAccount<'info>,

    /// CHECK: the user's associated token account for the badge (Token-2022), created here.
    #[account(
        mut,
        address = Pubkey::find_program_address(
            &[user.key().as_ref(), token_program.key().as_ref(), badge_mint.key().as_ref()],
            &associated_token::ID
        ).0
    )]
    pub user_badge_account: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn mint_badge_handler(ctx: Context<MintBadge>) -> Result<()> {
    let a = &ctx.accounts;
    // Double mint: the mint PDA must still be an empty system account. (Lamports alone don't
    // count: someone sending SOL to the address first must not be able to block the badge.)
    require!(
        a.badge_mint.data_is_empty() && a.badge_mint.owner == &anchor_lang::system_program::ID,
        CodeStreakError::BadgeAlreadyMinted
    );

    let participant_key = a.participant.key();
    let mint_seeds: &[&[u8]] = &[BADGE_MINT_SEED, participant_key.as_ref(), &[ctx.bumps.badge_mint]];
    let authority_seeds: &[&[u8]] = &[BADGE_AUTHORITY_SEED, &[ctx.bumps.badge_authority]];
    let system = a.system_program.key();
    let token = a.token_program.key();

    let name = format!("CodeStreak Survivor · {} days", a.challenge.num_days);
    let uri = format!("{}{}", BADGE_URI_BASE, participant_key);
    let metadata = TokenMetadata { name: name.clone(), symbol: BADGE_SYMBOL.to_string(), uri: uri.clone(), ..Default::default() };

    // 1. Size and fund the mint (base + NonTransferable + MetadataPointer, plus room for the metadata).
    let space = ExtensionType::try_calculate_account_len::<SplMint>(&[ExtensionType::NonTransferable, ExtensionType::MetadataPointer])?;
    let rent = Rent::get()?.minimum_balance(space + metadata.tlv_size_of()?);
    let missing = rent.saturating_sub(a.badge_mint.lamports());
    if missing > 0 {
        transfer(CpiContext::new(system, Transfer { from: a.payer.to_account_info(), to: a.badge_mint.to_account_info() }), missing)?;
    }
    allocate(CpiContext::new_with_signer(system, Allocate { account_to_allocate: a.badge_mint.to_account_info() }, &[mint_seeds]), space as u64)?;
    assign(CpiContext::new_with_signer(system, Assign { account_to_assign: a.badge_mint.to_account_info() }, &[mint_seeds]), &token)?;

    // 2. Extensions (before the mint is initialized), then the mint: 0 decimals, PDA mint authority,
    //    no freeze authority (nothing needs to freeze a soulbound badge).
    non_transferable_mint_initialize(CpiContext::new(
        token,
        NonTransferableMintInitialize { token_program_id: a.token_program.to_account_info(), mint: a.badge_mint.to_account_info() },
    ))?;
    metadata_pointer_initialize(
        CpiContext::new(token, MetadataPointerInitialize { token_program_id: a.token_program.to_account_info(), mint: a.badge_mint.to_account_info() }),
        Some(a.badge_authority.key()),
        Some(a.badge_mint.key()),
    )?;
    initialize_mint2(
        CpiContext::new(token, InitializeMint2 { mint: a.badge_mint.to_account_info() }),
        0,
        &a.badge_authority.key(),
        None,
    )?;

    // 3. Metadata on the mint itself (wallets and explorers read it from there).
    token_metadata_initialize(
        CpiContext::new_with_signer(
            token,
            TokenMetadataInitialize {
                program_id: a.token_program.to_account_info(),
                metadata: a.badge_mint.to_account_info(),
                update_authority: a.badge_authority.to_account_info(),
                mint_authority: a.badge_authority.to_account_info(),
                mint: a.badge_mint.to_account_info(),
            },
            &[authority_seeds],
        ),
        name,
        BADGE_SYMBOL.to_string(),
        uri,
    )?;

    // 4. The player's token account, and exactly one badge into it.
    associated_token::create(CpiContext::new(
        a.associated_token_program.key(),
        Create {
            payer: a.payer.to_account_info(),
            associated_token: a.user_badge_account.to_account_info(),
            authority: a.user.to_account_info(),
            mint: a.badge_mint.to_account_info(),
            system_program: a.system_program.to_account_info(),
            token_program: a.token_program.to_account_info(),
        },
    ))?;
    mint_to(
        CpiContext::new_with_signer(
            token,
            MintTo { mint: a.badge_mint.to_account_info(), to: a.user_badge_account.to_account_info(), authority: a.badge_authority.to_account_info() },
            &[authority_seeds],
        ),
        1,
    )?;

    // 5. Phase 37.3: remove the mint authority, so the supply is fixed at 1 for ever. Wallets and
    //    indexers only treat a token as an NFT (a collectible) when it has 0 decimals, supply 1 and
    //    no mint authority; with an authority left they show it as a fungible token.
    set_authority(
        CpiContext::new_with_signer(
            token,
            SetAuthority { current_authority: a.badge_authority.to_account_info(), account_or_mint: a.badge_mint.to_account_info() },
            &[authority_seeds],
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    emit!(BadgeMinted { challenge: a.challenge.key(), participant: participant_key, user: a.participant.user, mint: a.badge_mint.key() });
    Ok(())
}
