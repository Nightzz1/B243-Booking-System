CREATE TABLE auth_rate_limits (
  key varchar(64) PRIMARY KEY,
  generation uuid NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  blocked_until timestamptz,
  CONSTRAINT auth_rate_limits_hits_nonnegative CHECK (hits >= 0)
);
CREATE INDEX idx_auth_rate_limits_expires ON auth_rate_limits (expires_at);
