const { Pool } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const path = require('node:path');
const context = new AsyncLocalStorage();
let connection;
try {
  connection = new URL(process.env.DATABASE_URL);
  if (!['postgres:','postgresql:'].includes(connection.protocol)) throw Error();
} catch { throw Error('DATABASE_URL must be a PostgreSQL connection string.'); }
if (connection.hostname.endsWith('.neon.tech') && connection.searchParams.get('sslmode') === 'require') connection.searchParams.set('sslmode','verify-full');
const pool = new Pool({ connectionString: connection.toString(), max: 5, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
pool.on('error', () => console.error('PostgreSQL idle connection failed.'));
const ready = (async () => {
  const client=await pool.connect();
  try { await client.query(fs.readFileSync(path.join(__dirname, 'schema-postgres.sql'), 'utf8').replace(/^\uFEFF/,'')); }
  catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
})();
// Startup failures are handled by readiness middleware and the process entry point.
ready.catch(() => {});
function sqlForPostgres(sql) {
  let index = 0;
  sql = sql.replace(/\?/g, () => '$' + (++index));
  sql = sql.replace('INSERT OR REPLACE INTO wrong_answers', 'INSERT INTO wrong_answers');
  if (/^INSERT INTO wrong_answers/i.test(sql)) sql += ' ON CONFLICT (attempt_id,question_id) DO UPDATE SET selected_index=excluded.selected_index, created_at=CURRENT_TIMESTAMP';
  if (/^INSERT INTO (questions|options|attempts|wrong_answers|chat_messages|question_sets)\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) sql += ' RETURNING id';
  return sql.replace(/AS createdAt\b/g, 'AS "createdAt"').replace(/AS questionCount\b/g, 'AS "questionCount"');
}
function normalize(row) {
  return Object.fromEntries(Object.entries(row).map(([key,value]) => [key, value instanceof Date ? value.toISOString() : typeof value === 'string' && ['count','total','confirmed','unconfirmed','questionCount'].includes(key) && /^\d+$/.test(value) ? Number(value) : value]));
}
async function query(sql, values = []) {
  await ready;
  const active=context.getStore();
  if (!active) return pool.query(sqlForPostgres(sql),values);
  const work=active.pending.then(() => active.client.query(sqlForPostgres(sql),values));
  active.pending=work.catch(() => {});
  return work;
}
module.exports = {
  ready,
  prepare(sql) {
    return {
      async all(...values) { return (await query(sql,values)).rows.map(normalize); },
      async get(...values) { const row=(await query(sql,values)).rows[0]; return row ? normalize(row) : undefined; },
      async run(...values) { const result=await query(sql,values); return {changes:result.rowCount,lastInsertRowid:result.rows[0]?.id}; }
    };
  },
  async transaction(callback) {
    await ready;
    const client=await pool.connect();
    const state={client,pending:Promise.resolve()};
    try {
      await client.query('BEGIN');
      const result=await context.run(state,callback);
      await client.query('COMMIT');
      return result;
    } catch(error) { await state.pending; await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  },
  close() { return pool.end(); }
};
