CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username VARCHAR(18) NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '⚡',
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player','admin')),
  badges TEXT[] NOT NULL DEFAULT '{}',
  xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  games_played INTEGER NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  best_reaction INTEGER CHECK (best_reaction IS NULL OR best_reaction > 0),
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  last_played DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS game_scores (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('trivia','number','reflex')),
  points INTEGER NOT NULL CHECK (points >= 0 AND points <= 10000),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS game_scores_leaderboard_idx ON game_scores(points DESC, played_at DESC);
CREATE INDEX IF NOT EXISTS game_scores_user_idx ON game_scores(user_id, played_at DESC);
CREATE TABLE IF NOT EXISTS badge_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_type TEXT NOT NULL CHECK (badge_type IN ('verified','developer')),
  message VARCHAR(500) NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS badge_requests_one_pending_idx ON badge_requests(user_id, badge_type) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
