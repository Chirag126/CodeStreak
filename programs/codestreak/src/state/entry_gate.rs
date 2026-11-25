use anchor_lang::prelude::*;

/// Global entry gate, one per program. PDA seeds: ["entry_gate"].
///
/// When `authority` is set, creating a challenge, joining one and sponsoring one need that key as the
/// rent `payer` (in production the CodeStreak relayer, which signs only after the server's account
/// checks, e.g. moderation). Everything that returns money (claims, refunds), finalizing, settling
/// and Shields for an existing stake stay open to anyone, so the gate can never trap funds.
/// Not created yet, or `authority` = None: entry is open (the behaviour before Phase 37.2).
#[account]
#[derive(InitSpace)]
pub struct EntryGate {
    pub authority: Option<Pubkey>,
    pub bump: u8,
}
