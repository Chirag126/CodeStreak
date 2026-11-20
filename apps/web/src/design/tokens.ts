// Design tokens: the single source of truth for colors.
// globals.css must contain every value below (tokens.test.ts enforces it), and every
// foreground/background pairing the UI uses is listed in CONTRAST_PAIRS with its WCAG minimum.

export const palette = {
  charcoal: {
    950: '#0a0c0f',
    900: '#101318',
    850: '#151920',
    800: '#1b2029',
    700: '#262c37',
    600: '#39414f',
    500: '#646e80',
    400: '#8f97a6',
    300: '#b6bcc8',
    100: '#e6e9ef',
  },
  electric: {
    300: '#86efb4',
    400: '#3ddc84',
    500: '#22c06b',
    600: '#179e56',
    950: '#04160b',
  },
  cobalt: {
    300: '#9db8ff',
    400: '#6b95ff',
    600: '#2c5be0',
    700: '#2349b8',
  },
  danger: {
    400: '#f87171',
    600: '#c53030',
    700: '#a32626',
  },
  warning: {
    400: '#fbbf24',
  },
} as const;

/** Semantic roles (shadcn/ui naming) used by components. */
export const semantic = {
  background: palette.charcoal[950],
  foreground: palette.charcoal[100],
  card: palette.charcoal[900],
  'card-foreground': palette.charcoal[100],
  popover: palette.charcoal[850],
  'popover-foreground': palette.charcoal[100],
  muted: palette.charcoal[800],
  'muted-foreground': palette.charcoal[400],
  secondary: palette.charcoal[800],
  'secondary-foreground': palette.charcoal[100],
  border: palette.charcoal[700],
  input: palette.charcoal[500],
  ring: palette.electric[400],
  primary: palette.electric[400],
  'primary-foreground': palette.electric[950],
  accent: palette.cobalt[600],
  'accent-foreground': '#ffffff',
  link: palette.cobalt[400],
  success: palette.electric[400],
  warning: palette.warning[400],
  destructive: palette.danger[600],
  'destructive-foreground': '#ffffff',
  'destructive-text': palette.danger[400],
} as const;

export type SemanticToken = keyof typeof semantic;

/** WCAG 2.2: 4.5 for body text, 3 for large text and UI component boundaries. */
export const CONTRAST_PAIRS: { fg: string; bg: string; min: number; use: string }[] = [
  { fg: semantic.foreground, bg: semantic.background, min: 7, use: 'body text' },
  { fg: semantic.foreground, bg: semantic.card, min: 7, use: 'text on cards' },
  { fg: semantic['muted-foreground'], bg: semantic.background, min: 4.5, use: 'secondary text' },
  { fg: semantic['muted-foreground'], bg: semantic.card, min: 4.5, use: 'secondary text on cards' },
  { fg: semantic['muted-foreground'], bg: semantic.popover, min: 4.5, use: 'secondary text in popovers' },
  { fg: semantic['primary-foreground'], bg: semantic.primary, min: 4.5, use: 'primary button label' },
  { fg: semantic['primary-foreground'], bg: palette.electric[300], min: 4.5, use: 'primary button label (hover)' },
  { fg: semantic['accent-foreground'], bg: semantic.accent, min: 4.5, use: 'cobalt button label' },
  { fg: semantic['accent-foreground'], bg: palette.cobalt[700], min: 4.5, use: 'cobalt button label (hover)' },
  { fg: semantic['destructive-foreground'], bg: semantic.destructive, min: 4.5, use: 'destructive button label' },
  { fg: semantic.link, bg: semantic.background, min: 4.5, use: 'links' },
  { fg: semantic.link, bg: semantic.card, min: 4.5, use: 'links on cards' },
  { fg: semantic.success, bg: semantic.background, min: 4.5, use: 'success text' },
  { fg: semantic.warning, bg: semantic.background, min: 4.5, use: 'warning text' },
  { fg: semantic['destructive-text'], bg: semantic.background, min: 4.5, use: 'error text' },
  { fg: palette.electric[300], bg: semantic.card, min: 4.5, use: 'green badge text' },
  { fg: palette.cobalt[300], bg: semantic.card, min: 4.5, use: 'cobalt badge text' },
  { fg: semantic.input, bg: semantic.background, min: 3, use: 'input borders' },
  { fg: semantic.input, bg: semantic.card, min: 3, use: 'input borders on cards' },
  { fg: semantic.input, bg: semantic.popover, min: 3, use: 'input borders in popovers' },
  { fg: semantic.ring, bg: semantic.background, min: 3, use: 'focus ring' },
];
