use anchor_lang::prelude::*;

/// Program errors. Error numbers are 6000 + position: append new variants at the end only.
#[error_code]
pub enum CodeStreakError {
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("This token mint is not allowed for challenges")]
    MintNotAllowed,
    #[msg("Too many allowed mints")]
    TooManyMints,
    #[msg("Allowed mints contain a duplicate")]
    DuplicateMint,
    #[msg("Buy-in must be greater than zero")]
    InvalidBuyIn,
    #[msg("Day length must be between 60 seconds and one day")]
    InvalidDayLength,
    #[msg("Number of days must be between 1 and 60")]
    InvalidNumDays,
    #[msg("Start time must be in the future")]
    StartInPast,
    #[msg("Start time is too far in the future")]
    StartTooFar,
    #[msg("Join deadline must be in the future and no later than the start time")]
    InvalidJoinDeadline,
    #[msg("Participant limits are invalid")]
    InvalidParticipantLimits,
    #[msg("Verification and dispute windows must be between 1 minute and 7 days")]
    InvalidWindow,
    #[msg("Shield settings are invalid")]
    InvalidShieldConfig,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    // ---- Phase 6: join and sponsor ----
    #[msg("Joining is closed for this challenge")]
    JoinClosed,
    #[msg("This challenge is full")]
    PoolFull,
    #[msg("This is a private challenge: the group's join authority must co-sign")]
    JoinAuthorityRequired,
    #[msg("Wrong join authority for this challenge")]
    InvalidJoinAuthority,
    #[msg("Vault does not belong to this challenge")]
    InvalidVault,
    #[msg("Token mint does not match this challenge")]
    InvalidMint,
    #[msg("Token program does not match this challenge")]
    InvalidTokenProgram,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Sponsorship is closed for this challenge")]
    SponsorshipClosed,
    #[msg("Vault did not receive the exact amount (transfer fees are not supported)")]
    TransferAmountMismatch,
}
