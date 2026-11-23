/** CodeStreak runs on Solana devnet only. Mainnet is never configured anywhere. */
export const CLUSTER = 'devnet' as const;
export type Cluster = typeof CLUSTER;

/** Circle's devnet USDC mint (confirm on faucet.circle.com). */
export const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
/** Native SOL wrapped as an SPL token. SOL pools use this mint. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export const USDC_DECIMALS = 6;
export const SOL_DECIMALS = 9;

export const SECONDS_PER_DAY = 86_400;

/** Challenge durations offered in the app (days). Demo challenges use a shorter day length instead. */
export const CHALLENGE_DURATIONS_DAYS = [3, 7, 14, 30] as const;
export type ChallengeDurationDays = (typeof CHALLENGE_DURATIONS_DAYS)[number];

/** Default minimum meaningful added lines per qualifying GitHub day (groups can change it). */
export const DEFAULT_MIN_MEANINGFUL_LINES = 15;

/** Source file extensions that count toward GitHub activity. */
/** Source files that count by default (a creator's file filter can narrow this further). */
export const ELIGIBLE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.py', '.cpp', '.cc', '.c', '.h', '.hpp', '.go', '.java', '.kt',
  '.swift', '.cs', '.rb', '.php', '.sol', '.scala', '.dart', '.vue', '.svelte', '.sql', '.sh', '.lua', '.zig', '.ex', '.hs',
] as const;

/** Daily verification outcome. INDETERMINATE never causes forfeiture on its own. */
export const VERIFICATION_STATUSES = ['VERIFIED', 'FAILED', 'INDETERMINATE'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Limits on a challenge creator's GitHub options (shared by the wizard and the verifier). */
export const GITHUB_OPTION_LIMITS = { docsCapShare: 0.5, generatedCapShare: 0.25, maxBackdateHours: 72, maxFilterEntries: 20 } as const;
