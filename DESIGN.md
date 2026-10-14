# NEXPLAY Design System

## Product direction
NEXPLAY is a quick-session browser arcade for curious players. It should feel like an energetic midnight gaming arena—not a generic admin template. Keep the visual focus on the games and make it effortless to start a round.

## Visual tokens
- **Midnight** `#070D1B`: page canvas and loading screen.
- **Deep navy** `#0C1729`: primary surface.
- **Arena blue** `#28BFFF`: primary actions and focus accent.
- **Signal cyan** `#72EDFF`: highlights, live status, and XP.
- **Electric violet** `#5C7CFF`: secondary energy accent.
- **Mint** `#6EF0C2`: success and positive feedback.
- **Soft red** `#FF7D9A`: errors and misses.
- Display type: Space Grotesk; body: DM Sans; compact stats: DM Mono.

## Layout and motion
- Use the glowing orbital energy core as the signature hero visual; avoid adding competing decoration to every card.
- Keep cards dark and layered with restrained blue/cyan light, clear hierarchy, and readable body copy.
- Motion should confirm action: reveal on scroll, small hover lift, modal entrance, loading pulse, and game feedback. Respect `prefers-reduced-motion`.
- Prioritize touch-friendly controls, visible keyboard focus, responsive game dialogs, and readable mobile navigation.

## Product behavior
- The three games remain playable without an account.
- Local browser progress is the offline fallback; authenticated players sync supported stats, scores, achievements, and badges through `/api`.
- Leaderboard entries and community badges must come from the API when available. Do not present sample/demo entries as verified real users.
- Admin moderation must use server-authorized routes. Never reintroduce local-only admin grants or trust a client-side role check for authorization.
- Preserve the **Crafted by X-DEVS** footer credit in all redesigns.

## Interaction states
Every account, score, badge, and admin workflow should have a loading state, success feedback, and a specific error message. Do not hide API failure; retain local play and identify demo/offline leaderboard state honestly.
