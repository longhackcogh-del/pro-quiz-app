const router=require('express').Router();
const db=require('./database');
const {ownerId}=require('./ownership');
router.get('/',async(_req,res)=>res.json(await db.prepare('SELECT id,name FROM question_folders WHERE owner_id=? ORDER BY id').all(ownerId())));
router.post('/',async(req,res)=>{
  const name=typeof req.body?.name==='string'?req.body.name.trim():'';
  if(!name||name.length>100)return res.status(400).json({error:'Tên thư mục cần từ 1 đến 100 ký tự.'});
  const folder=await db.prepare('INSERT INTO question_folders (owner_id,name) VALUES (?,?) RETURNING id,name').get(ownerId(),name);
  res.status(201).json(folder);
});
router.patch('/:id',async(req,res)=>{
  const name=typeof req.body?.name==='string'?req.body.name.trim():'';
  if(!name||name.length>100)return res.status(400).json({error:'Tên thư mục cần từ 1 đến 100 ký tự.'});
  const result=await db.prepare('UPDATE question_folders SET name=? WHERE id=? AND owner_id=?').run(name,Number(req.params.id),ownerId());
  if(!result.changes)return res.status(404).json({error:'Không tìm thấy thư mục.'});
  res.json({ok:true});
});
router.delete('/:id',async(req,res)=>{
  const result=await db.prepare('DELETE FROM question_folders WHERE id=? AND owner_id=?').run(Number(req.params.id),ownerId());
  if(!result.changes)return res.status(404).json({error:'Không tìm thấy thư mục.'});
  res.json({ok:true});
});
module.exports=router;
