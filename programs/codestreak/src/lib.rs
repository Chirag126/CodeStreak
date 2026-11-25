//! CodeStreak: escrow, verification and settlement for coding-streak challenges (Solana devnet).
//!
//! Implemented: global config, challenge pools with a program-owned token vault (Phase 5),
//! joining and sponsoring (Phase 6), verification records and Shields (Phase 7),
//! finalization, settlement, cancellation and pull-based claims (Phase 8).
use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod rules;
pub mod state;
pub mod validation;

use instructions::*;
pub use state::DayResult;
pub use validation::InitializePoolParams;

declare_id!("A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J");

#[program]
pub mod codestreak {
    use super::*;

    /// One-time setup by the program's upgrade authority.
    pub fn initialize_config(ctx: Context<InitializeConfig>, admin: Pubkey, default_verifier: Pubkey, allowed_mints: Vec<Pubkey>) -> Result<()> {
        initialize_config_handler(ctx, admin, default_verifier, allowed_mints)
    }

    /// Admin-only changes for future challenges (allowed mints, default verifier, admin rotation).
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_admin: Option<Pubkey>,
        new_default_verifier: Option<Pubkey>,
        new_allowed_mints: Option<Vec<Pubkey>>,
    ) -> Result<()> {
        update_config_handler(ctx, new_admin, new_default_verifier, new_allowed_mints)
    }

    /// Creates a challenge pool and its program-owned vault.
    pub fn initialize_pool(ctx: Context<InitializePool>, params: InitializePoolParams) -> Result<()> {
        initialize_pool_handler(ctx, params)
    }

    /// Deposits the buy-in and creates the user's Participant account (private: join authority co-signs).
    pub fn join_pool(ctx: Context<JoinPool>) -> Result<()> {
        join_pool_handler(ctx)
    }

    /// Adds `amount` to the reward pool and updates the sponsor's on-chain receipt.
    pub fn sponsor_pool(ctx: Context<SponsorPool>, amount: u64) -> Result<()> {
        sponsor_pool_handler(ctx, amount)
    }

    /// Verifier records one participant-day result. One-way: only upgrades to Verified after a first result.
    pub fn record_verification(ctx: Context<RecordVerification>, day: u16, result: DayResult, evidence_hash: [u8; 32]) -> Result<()> {
        record_verification_handler(ctx, day, result, evidence_hash)
    }

    /// Participant pays the Shield price to protect `day` (until the grace period after it ends).
    pub fn activate_shield(ctx: Context<ActivateShield>, day: u16) -> Result<()> {
        activate_shield_handler(ctx, day)
    }

    /// Permissionless after the dispute window: fixes one participant's outcome from their days.
    pub fn finalize_participant(ctx: Context<FinalizeParticipant>) -> Result<()> {
        finalize_participant_handler(ctx)
    }

    /// Permissionless once everyone is finalized: fixes the payout split (moves no funds).
    pub fn settle_challenge(ctx: Context<SettleChallenge>) -> Result<()> {
        settle_challenge_handler(ctx)
    }

    /// Creator before start, or anyone when joining closed under the minimum.
    pub fn cancel_pool(ctx: Context<CancelPool>) -> Result<()> {
        cancel_pool_handler(ctx)
    }

    /// Survivor payout (stake + share; dust to the last survivor). Paid only to the participant's own account.
    pub fn claim_reward(ctx: Context<ClaimParticipant>) -> Result<()> {
        claim_reward_handler(ctx)
    }

    /// Participant refund (cancelled, nobody survived, or voided).
    pub fn claim_refund(ctx: Context<ClaimParticipant>) -> Result<()> {
        claim_refund_handler(ctx)
    }

    /// Sponsor refund (cancelled or nobody survived).
    pub fn claim_sponsor_refund(ctx: Context<ClaimSponsorRefund>) -> Result<()> {
        claim_sponsor_refund_handler(ctx)
    }

    /// Admin-only (Phase 37.2): the key that must approve (pay for) new challenges, joins and
    /// sponsorships. None = open. Claims, refunds, finalizing, settling and Shields are never gated.
    pub fn set_entry_gate(ctx: Context<SetEntryGate>, authority: Option<Pubkey>) -> Result<()> {
        set_entry_gate_handler(ctx, authority)
    }

    /// Mints the soulbound Token-2022 survivor badge into a Survived player's wallet (anyone may pay).
    pub fn mint_badge(ctx: Context<MintBadge>) -> Result<()> {
        mint_badge_handler(ctx)
    }
}
