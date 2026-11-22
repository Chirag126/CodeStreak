export interface NavItem {
  href: string;
  label: string;
  /** Shown only in development builds. */
  devOnly?: boolean;
}

// Only routes that exist are listed (no dead links). Later phases add the Leaderboard.
const ALL_ITEMS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/challenges', label: 'Challenges' },
  { href: '/styleguide', label: 'Style guide', devOnly: true },
];

export const NAV_ITEMS: NavItem[] = ALL_ITEMS.filter((item) => !item.devOnly || process.env.NODE_ENV !== 'production');

export const REPO_URL = 'https://github.com/Chirag126/CodeStreak';
