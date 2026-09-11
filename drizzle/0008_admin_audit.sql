CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL,
  actor_account text NOT NULL,
  actor_name text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC, id DESC);
