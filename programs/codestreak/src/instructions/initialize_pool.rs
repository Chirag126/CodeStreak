use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::CodeStreakError;
use crate::events::PoolCreated;
use crate::instructions::shared::check_entry_gate;
use crate::state::{Challenge, Config, PoolState};
use crate::validation::{validate_pool_params, InitializePoolParams};

/// Creates a challenge and its token vault.
/// `payer` (the CodeStreak relayer) pays rent; `creator` owns the challenge. With the entry gate set,
/// the payer must be the gate authority, so CodeStreak approves every new challenge.
#[derive(Accounts)]
#[instruction(params: InitializePoolParams)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub creator: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: the global entry gate PDA (address enforced by the seeds). Read in the handler: not
    /// created yet = open; otherwise the payer must be its authority (the CodeStreak relayer).
    #[account(seeds = [ENTRY_GATE_SEED], bump)]
    pub entry_gate: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Challenge::INIT_SPACE,
        seeds = [CHALLENGE_SEED, creator.key().as_ref(), &params.challenge_id.to_le_bytes()],
        bump
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    #[account(
        mint::token_program = token_program,
        constraint = config.is_mint_allowed(&mint.key()) @ CodeStreakError::MintNotAllowed
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// Program-owned vault: its authority is the challenge PDA, so only program logic can move funds.
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED, challenge.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = challenge,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_pool_handler(ctx: Context<InitializePool>, params: InitializePoolParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    check_entry_gate(&ctx.accounts.entry_gate, &ctx.accounts.payer.key())?;
    let end_ts = validate_pool_params(&params, now)?;

    let challenge = &mut ctx.accounts.challenge;
    challenge.version = Challenge::VERSION;
    challenge.bump = ctx.bumps.challenge;
    challenge.vault_bump = ctx.bumps.vault;
    challenge.creator = ctx.accounts.creator.key();
    challenge.challenge_id = params.challenge_id;
    challenge.mint = ctx.accounts.mint.key();
    challenge.vault = ctx.accounts.vault.key();
    challenge.token_program = ctx.accounts.token_program.key();
    challenge.verifier = ctx.accounts.config.default_verifier;
    challenge.join_authority = params.join_authority;
    challenge.buy_in = params.buy_in;
    challenge.start_ts = params.start_ts;
    challenge.day_length_secs = params.day_length_secs;
    challenge.num_days = params.num_days;
    challenge.join_deadline_ts = params.join_deadline_ts;
    challenge.min_participants = params.min_participants;
    challenge.max_participants = params.max_participants;
    challenge.shield_price = params.shield_price;
    challenge.max_shields_per_participant = params.max_shields_per_participant;
    challenge.shield_grace_secs = params.shield_grace_secs;
    challenge.verify_window_secs = params.verify_window_secs;
    challenge.dispute_window_secs = params.dispute_window_secs;
    challenge.rules_hash = params.rules_hash;
    challenge.is_demo = params.day_length_secs < SECONDS_PER_DAY;
    challenge.state = PoolState::Open;
    challenge.created_at = now;
    // Counters start at zero (account data is zero-initialized).

    emit!(PoolCreated {
        challenge: challenge.key(),
        creator: challenge.creator,
        challenge_id: challenge.challenge_id,
        mint: challenge.mint,
        vault: challenge.vault,
        buy_in: challenge.buy_in,
        start_ts: challenge.start_ts,
        end_ts,
        num_days: challenge.num_days,
        day_length_secs: challenge.day_length_secs,
        is_private: challenge.is_private(),
        is_demo: challenge.is_demo,
    });
    Ok(())
}
