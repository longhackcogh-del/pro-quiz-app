const router = require('express').Router();
const db = require('./database');
const { ownerId } = require('./ownership');

router.get('/', (_req,res) => {
  res.json(db.prepare('SELECT s.id,s.name,COUNT(q.id) AS questionCount FROM question_sets s LEFT JOIN questions q ON q.set_id=s.id AND q.owner_id=s.owner_id WHERE s.owner_id=? GROUP BY s.id ORDER BY s.id').all(ownerId()));
});
router.post('/', (req,res) => {
  const name=typeof req.body.name==='string' ? req.body.name.trim() : '';
  if (!name || name.length>100) return res.status(400).json({error:'Tên bộ câu hỏi cần từ 1 đến 100 ký tự.'});
  const result=db.prepare('INSERT INTO question_sets (owner_id,name) VALUES (?,?)').run(ownerId(),name);
  res.status(201).json({id:Number(result.lastInsertRowid),name,questionCount:0});
});
router.patch('/:id', (req,res) => {
  const name=typeof req.body.name==='string' ? req.body.name.trim() : '';
  if (!name || name.length>100) return res.status(400).json({error:'Tên bộ câu hỏi cần từ 1 đến 100 ký tự.'});
  const result=db.prepare('UPDATE question_sets SET name=? WHERE id=? AND owner_id=?').run(name,Number(req.params.id),ownerId());
  if (!result.changes) return res.status(404).json({error:'Không tìm thấy bộ câu hỏi.'});
  res.json({ok:true});
});
router.delete('/:id', (req,res) => {
  const result=db.prepare('DELETE FROM question_sets WHERE id=? AND owner_id=?').run(Number(req.params.id),ownerId());
  if (!result.changes) return res.status(404).json({error:'Không tìm thấy bộ câu hỏi.'});
  res.json({ok:true});
});
router.patch('/contents/move', (req,res) => {
  const {questionIds,setId}=req.body;
  if (!Array.isArray(questionIds) || !questionIds.length || questionIds.length>1000 || !questionIds.every(Number.isSafeInteger) || (setId!==null && !Number.isSafeInteger(setId))) return res.status(400).json({error:'Danh sách câu hỏi hoặc bộ đích không hợp lệ.'});
  if (setId!==null && !db.prepare('SELECT id FROM question_sets WHERE id=? AND owner_id=?').get(setId,ownerId())) return res.status(404).json({error:'Không tìm thấy bộ câu hỏi.'});
  const ids=[...new Set(questionIds)];
  const placeholders=ids.map(()=>'?').join(',');
  if (db.prepare(`SELECT COUNT(*) AS count FROM questions WHERE owner_id=? AND id IN (${placeholders})`).get(ownerId(),...ids).count!==ids.length) return res.status(404).json({error:'Không tìm thấy câu hỏi thuộc tài khoản của bạn.'});
  db.prepare(`UPDATE questions SET set_id=? WHERE owner_id=? AND id IN (${placeholders})`).run(setId,ownerId(),...ids);
  res.json({ok:true,moved:ids.length});
});
module.exports=router;
