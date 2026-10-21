CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  provider_user_id varchar(255) NOT NULL,
  email varchar(320),
  is_private_email boolean NOT NULL DEFAULT false,
  apple_refresh_token text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_social_provider_user UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_provider_user ON social_accounts (provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_sessions (family_id);
