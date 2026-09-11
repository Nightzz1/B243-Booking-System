import type { PoolClient } from 'pg';

// Call inside the business transaction; pass only explicitly selected non-secret fields.
export async function recordAdminAction(
  client: PoolClient,
  actorId: string,
  action: string,
  target: string,
  details: object = {},
) {
  const result = await client.query(
    `INSERT INTO admin_audit_logs (id, actor_id, actor_account, actor_name, action, target, details)
     SELECT $1, id, account, display_name, $3, $4, $5::jsonb FROM users WHERE id = $2 RETURNING id`,
    [crypto.randomUUID(), actorId, action, target, JSON.stringify(details)],
  );
  if (!result.rowCount) throw new Error('Audit actor does not exist');
}
