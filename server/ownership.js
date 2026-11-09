const { AsyncLocalStorage } = require('node:async_hooks');
const db = require('./database');
const scope = new AsyncLocalStorage();
function ownerId() {
  const id = scope.getStore();
  if (!id) throw new Error('Authenticated account scope is required');
  return id;
}
async function requireAccount(req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.vary('Cookie');
  if (!req.user) return res.status(401).json({ error: 'Bạn cần đăng nhập Google để sử dụng kho dữ liệu cá nhân.' });
  const user = req.user;
  if (req.get('X-Quiz-Account') && req.get('X-Quiz-Account') !== user.id) return res.status(409).json({ error: 'Tài khoản đã thay đổi. Hãy tải lại dữ liệu của tài khoản hiện tại.' });
  res.set('X-Quiz-Account', user.id);
  await db.transaction(async () => {
    (await db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name').run(user.id, user.email, user.name));
    const legacyEmail = process.env.LEGACY_OWNER_EMAIL?.trim().toLowerCase();
    if (legacyEmail && user.email.toLowerCase() === legacyEmail && !(await db.prepare("SELECT value FROM app_meta WHERE key='legacy_owner_id'").get())) {
      (await db.prepare('UPDATE questions SET owner_id = ? WHERE owner_id IS NULL').run(user.id));
      (await db.prepare('UPDATE attempts SET owner_id = ? WHERE owner_id IS NULL').run(user.id));
      (await db.prepare("INSERT INTO app_meta (key,value) VALUES ('legacy_owner_id',?)").run(user.id));
    }
  });
  scope.run(user.id, next);
}
module.exports = { ownerId, requireAccount };
