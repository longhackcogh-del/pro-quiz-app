const usePostgres = process.env.DATABASE_DRIVER === 'postgres' || (process.env.DATABASE_URL && !process.env.DATABASE_FILE && process.env.DATABASE_DRIVER !== 'sqlite');
if (usePostgres) {
  module.exports = require('./database-postgres');
} else {
  const db = require('./database-sqlite');
  let pending = Promise.resolve();
  db.ready = Promise.resolve();
  db.transaction = callback => {
    const work = pending.then(async () => {
      db.exec('BEGIN IMMEDIATE');
      try { const result = await callback(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    });
    pending = work.catch(() => {});
    return work;
  };
  module.exports = db;
}
