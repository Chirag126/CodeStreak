# Manual QA checklist (Phase 41)

Run it before a demo or release. Use Chrome DevTools → device toolbar → **iPhone SE (375 × 667)**, then repeat the starred rows at desktop width (≥ 1280 px) to confirm nothing regressed. Check each page **signed out**, **signed in as a regular user** and **signed in as the owner** where it applies.

For every page:
- **375 px:** no sideways scrolling of the whole page. Wide tables scroll inside their own box. Buttons are tappable and text doesn't overlap.
- **Loading:** a skeleton shows while data loads (no blank screen, no fake numbers).
- **Empty:** a brand-new account sees a clear sentence and a next step, never a broken table.
- **Error:** with the network throttled to Offline, then reloaded, the "This page hit a problem" card shows Try again, Dashboard and Challenges.
- **Motion:** footer → Animations → **Reduced**: nothing slides or scales and number counters jump straight to the value. **Full** animates even if the OS asks for less.

| Page | Who | 375 px | Loading | Empty state | Error | Motion | Notes |
|---|---|---|---|---|---|---|---|
| `/` landing ★ | all | ☐ | ☐ | "No public challenge is open" | ☐ | grid fills in; off when Reduced | numbers match `/admin` overview |
| `/sign-in` | out | ☐ | ☐ | – | ☐ | ☐ | magic link and wallet sign-in |
| `/onboarding/username` | new | ☐ | ☐ | – | ☐ | ☐ | |
| header + menu ★ | all | ☐ | – | – | – | ☐ | phone: Dashboard, Profile and Control Center are in the ☰ menu |
| `/dashboard` ★ | user | ☐ | ☐ | new user: "No challenge running" | ☐ | ☐ | public ID row wraps |
| `/dashboard/history` | user | ☐ | ☐ | ☐ | ☐ | ☐ | table scrolls inside its box |
| `/dashboard/insights` | user | ☐ | ☐ | ☐ | ☐ | ☐ | |
| `/dashboard/claims` | user | ☐ | ☐ | "Nothing to claim" | ☐ | ☐ | |
| `/dashboard/badges` | user | ☐ | ☐ | ☐ | ☐ | ☐ | |
| `/dashboard/notifications` | user | ☐ | ☐ | ☐ | ☐ | ☐ | |
| `/dashboard/wallet` | user | ☐ | ☐ | no wallet linked | ☐ | ☐ | addresses wrap |
| `/dashboard/settings` | user | ☐ | ☐ | no accounts linked | ☐ | ☐ | |
| `/dashboard/disputes` | user | ☐ | ☐ | ☐ | ☐ | ☐ | |
| `/dashboard/account` | user | ☐ | ☐ | "good standing" | ☐ | ☐ | appeal form when restricted |
| `/challenges` ★ | all | ☐ | ☐ | filters with no match | ☐ | ☐ | |
| `/challenges/new` | user | ☐ | ☐ | – | ☐ | ☐ | wizard Back/Next stay on screen |
| `/challenges/[address]` ★ | all | ☐ | ☐ | no players yet | ☐ | ☐ | join, Shield and sponsor panels; vault address wraps |
| `/leaderboards` | all | ☐ | ☐ | ☐ | ☐ | rank changes animate; off when Reduced | |
| `/u/[username]` ★ | all | ☐ | ☐ | no badges / no history | ☐ | ☐ | Embed and Report dialogs scroll on short screens |
| `/u/nobody_here` | all | ☐ | – | 404 page | – | – | |
| `/invite/[token]` | user | ☐ | ☐ | expired link message | ☐ | ☐ | |
| `/sponsor/[token]` | all | ☐ | ☐ | expired link message | ☐ | ☐ | |
| `/widget-demo.html` | all | ☐ | – | `?u=nobody_here` placeholder | – | – | |
| `/admin` overview ★ | owner | ☐ | ☐ | – | ☐ | ☐ | nav scrolls sideways on phones |
| `/admin/users` + `[id]` | owner | ☐ | ☐ | no match | ☐ | ☐ | tabs wrap; action dialog scrolls |
| `/admin/challenges`, `groups`, `transactions`, `verification`, `moderation`, `audit`, `settings`, `disputes` | owner | ☐ | ☐ | ☐ | ☐ | ☐ | tables scroll inside their box |
| Blinks (`/api/actions/...`) | – | – | – | closed challenge disabled | ActionError | – | Inspector / dial.to |

★ = also check at desktop width.

Already checked while building Phase 41: landing, public profile, signed-out header and challenge list live at 500 px (the narrowest the review browser allows); everything else by reading the code for fixed widths, rows that don't wrap and long unbroken text.
