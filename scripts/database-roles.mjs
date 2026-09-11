// Executed by the privileged migrator, never by the web process.
export async function configureDatabaseRoles(client) {
  const appPassword = process.env.APP_DB_PASSWORD;
  const backupPassword = process.env.BACKUP_DB_PASSWORD;
  if (!appPassword && !backupPassword) return;
  if (
    !appPassword ||
    !backupPassword ||
    appPassword.length < 24 ||
    backupPassword.length < 24 ||
    appPassword === backupPassword
  )
    throw new Error(
      'Provide distinct APP_DB_PASSWORD and BACKUP_DB_PASSWORD of at least 24 characters',
    );
  const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
  const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
  const {
    rows: [context],
  } = await client.query(
    'SELECT current_database() AS db, current_user AS owner',
  );
  if (['booking_app', 'booking_backup'].includes(context.owner))
    throw new Error('Role provisioning requires the migration owner');
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL standard_conforming_strings = on');
    for (const [name, password] of [
      ['booking_app', appPassword],
      ['booking_backup', backupPassword],
    ]) {
      const exists = await client.query(
        'SELECT 1 FROM pg_roles WHERE rolname=$1',
        [name],
      );
      if (!exists.rowCount)
        await client.query(`CREATE ROLE ${quote(name)} LOGIN`);
      // Never log this SQL: it contains credentials.
      await client.query(
        `ALTER ROLE ${quote(name)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(password)}`,
      );
      const memberships = await client.query(
        'SELECT parent.rolname FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member WHERE child.rolname=$1',
        [name],
      );
      for (const row of memberships.rows)
        await client.query(`REVOKE ${quote(row.rolname)} FROM ${quote(name)}`);
      await client.query(
        `GRANT CONNECT ON DATABASE ${quote(context.db)} TO ${quote(name)}`,
      );
      await client.query(`GRANT USAGE ON SCHEMA public TO ${quote(name)}`);
      await client.query(
        `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quote(name)}`,
      );
      await client.query(
        `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${quote(name)}`,
      );
    }
    await client.query(
      `REVOKE CREATE ON SCHEMA public FROM PUBLIC, booking_app, booking_backup`,
    );
    await client.query(
      `REVOKE CREATE, TEMPORARY ON DATABASE ${quote(context.db)} FROM PUBLIC, booking_app, booking_backup`,
    );
    await client.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO booking_app',
    );
    await client.query(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO booking_app',
    );
    await client.query('REVOKE ALL ON _app_migrations FROM booking_app');
    await client.query(
      'REVOKE UPDATE, DELETE, TRUNCATE ON admin_audit_logs FROM booking_app',
    );
    await client.query(
      'GRANT SELECT ON ALL TABLES IN SCHEMA public TO booking_backup',
    );
    await client.query(
      'GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO booking_backup',
    );
    // Grants are reapplied after every migration; no broad future grants to audit tables.
    await client.query("ALTER ROLE booking_app SET statement_timeout = '30s'");
    await client.query("ALTER ROLE booking_app SET lock_timeout = '5s'");
    await client.query(
      "ALTER ROLE booking_app SET idle_in_transaction_session_timeout = '30s'",
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    // PostgreSQL errors can contain the SQL/password. Do not forward the raw object.
    throw new Error(
      `Database role provisioning failed (${error.code ?? 'unknown'})`,
    );
  }
}
