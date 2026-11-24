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
    // ---- Phase 7: verification and Shields ----
    #[msg("Only this challenge's verifier can record results")]
    NotVerifier,
    #[msg("Day is outside this challenge")]
    InvalidDay,
    #[msg("This day has not ended yet")]
    DayNotOver,
    #[msg("The window for recording this result has closed")]
    VerificationClosed,
    #[msg("A verified day is final and cannot be changed")]
    VerifiedIsFinal,
    #[msg("Results can only be upgraded to Verified")]
    InvalidTransition,
    #[msg("Participant does not belong to this challenge")]
    ParticipantMismatch,
    #[msg("Participant is already finalized")]
    AlreadyFinalized,
    #[msg("Shields are disabled for this challenge")]
    ShieldsDisabled,
    #[msg("Shield limit reached for this challenge")]
    ShieldLimitReached,
    #[msg("This day has not started yet")]
    DayNotStarted,
    #[msg("The Shield grace period for this day is over")]
    ShieldWindowClosed,
    #[msg("This day is already shielded")]
    DayAlreadyShielded,
    #[msg("This day is already verified: no Shield needed")]
    DayAlreadyVerified,
    // ---- Phase 8: settlement and claims ----
    #[msg("Too early: the verification and dispute windows are still open")]
    TooEarly,
    #[msg("Every participant must be finalized before settlement")]
    NotAllFinalized,
    #[msg("Challenge is already settled")]
    AlreadySettled,
    #[msg("Challenge was cancelled")]
    ChallengeCancelled,
    #[msg("Not enough participants: the challenge must be cancelled and refunded")]
    BelowMinimumParticipants,
    #[msg("Challenge is not settled or cancelled yet")]
    NotSettled,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("This challenge cannot be cancelled now")]
    CannotCancel,
    #[msg("Only players who kept their streak (Survived) can mint a badge")]
    NotSurvivor,
    #[msg("This player's badge was already minted")]
    BadgeAlreadyMinted,
}
