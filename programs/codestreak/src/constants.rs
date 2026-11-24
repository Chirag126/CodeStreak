//! Seeds and limits. Changing a seed changes every derived address: never edit after deploy.

pub const CONFIG_SEED: &[u8] = b"config";
pub const CHALLENGE_SEED: &[u8] = b"challenge";
pub const VAULT_SEED: &[u8] = b"vault";
pub const PARTICIPANT_SEED: &[u8] = b"participant";
pub const SPONSOR_SEED: &[u8] = b"sponsor";
/// Soulbound survivor badge: one Token-2022 mint per Participant, minted by the program's PDA.
pub const BADGE_MINT_SEED: &[u8] = b"badge";
pub const BADGE_AUTHORITY_SEED: &[u8] = b"badge_authority";

/// Badge metadata: fixed in the program so whoever pays for the mint can't change what it says.
pub const BADGE_SYMBOL: &str = "STREAK";
/// The metadata JSON is served by the app for each participant: `<base><participant>`.
pub const BADGE_URI_BASE: &str = "https://codestreak-k0uv.onrender.com/api/badges/";

/// Maximum number of token mints a challenge may use (devnet USDC, wrapped SOL, spare slots).
pub const MAX_ALLOWED_MINTS: usize = 4;

/// One real day. Shorter day lengths are allowed only for clearly labeled demo challenges.
pub const SECONDS_PER_DAY: u32 = 86_400;
pub const MIN_DAY_LENGTH_SECS: u32 = 60;
pub const MAX_NUM_DAYS: u16 = 60;

pub const MIN_PARTICIPANTS: u16 = 2;
pub const MAX_PARTICIPANTS: u16 = 1_000;

/// Verification and dispute windows: at least a minute, at most a week.
pub const MIN_WINDOW_SECS: u32 = 60;
pub const MAX_WINDOW_SECS: u32 = 7 * SECONDS_PER_DAY;

/// A challenge can be scheduled at most this far ahead.
pub const MAX_START_DELAY_SECS: i64 = 90 * SECONDS_PER_DAY as i64;

pub const MAX_SHIELDS_PER_PARTICIPANT: u8 = 3;
