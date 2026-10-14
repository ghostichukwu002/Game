# NEXPLAY

NEXPLAY is a mobile-friendly browser game arena with Brain Blitz, Number Rush, Reflex Rally, player profiles, XP, achievements, verification/developer badges and X-DEVS credit.

## Backend

The `api/index.js` serverless API uses PostgreSQL for persistent accounts, scores, global rankings, badge requests, admin moderation and audit history. It is designed to deploy alongside the static `index.html` on Vercel.

### Required environment variables

- `DATABASE_URL`: PostgreSQL connection string from your database provider.
- `JWT_SECRET`: a random secret at least 32 characters long. Keep it private.
- `ADMIN_EMAIL`: the exact email address that should receive the admin role when that account registers for the first time.
- `ADMIN_SETUP_TOKEN`: a separate random secret of at least 24 characters. Only enter this in the first admin registration; it prevents someone who knows the admin email from claiming the role.
- `ALLOWED_ORIGINS`: optional comma-separated origins if the frontend is served from a different domain. Leave unset for same-origin deployment.

### Deploy

1. Create a PostgreSQL database (Neon or Supabase works).
2. In the Vercel project connected to this repository, add the variables above under Project Settings → Environment Variables.
3. Set `ADMIN_EMAIL` to your own account email and `ADMIN_SETUP_TOKEN` to a different random secret **before registering that account**. Enter that setup code only when creating the admin account. The role is assigned on registration; existing users do not become admins just by changing the variable.
4. Redeploy the Vercel project.
5. Open `/api/health`; it should return `{"ok":true,"service":"NEXPLAY API",...}`.
6. Register an account with the configured admin email and the admin setup code. Open the account menu to access the admin dashboard.

The API creates its tables and indexes automatically on first use. `database/schema.sql` is also provided for manual setup. Never put database credentials or JWT secrets in `index.html`.

## API routes

- `POST /api/register`, `POST /api/login`, `GET /api/me`, `PATCH /api/profile`
- `POST /api/scores`, `GET /api/leaderboard`
- `POST /api/badges/request`, `GET /api/badges/mine`
- `GET /api/admin/overview`, `GET /api/admin/badges`, `PATCH /api/admin/badges/:id`
- `GET /api/admin/users`, `PATCH /api/admin/users/badges`, `GET /api/admin/audit`

Scores are tied to authenticated accounts and recorded server-side. As with any browser game, the API cannot fully prevent a modified client from submitting fabricated scores; competitive anti-cheat requires server-authoritative gameplay validation.

## Local-only fallback

If the API is not configured yet, the game remains playable and continues saving progress to the current browser. Cloud accounts, online leaderboard and secure badge moderation require the environment variables and database above.
