const router = require('express').Router();
const db = require('./database');
const { ownerId } = require('./ownership');

router.get('/', async (_req,res) => {
  res.json((await db.prepare('SELECT s.id,s.name,s.folder_id,COUNT(q.id) AS questionCount FROM question_sets s LEFT JOIN questions q ON q.set_id=s.id AND q.owner_id=s.owner_id WHERE s.owner_id=? GROUP BY s.id ORDER BY s.id').all(ownerId())).map(({folder_id,...set})=>({...set,folderId:folder_id})));
});
router.post('/', async (req,res) => {
  const name=typeof req.body.name==='string' ? req.body.name.trim() : '';
  if (!name || name.length>100) return res.status(400).json({error:'Tên bộ câu hỏi cần từ 1 đến 100 ký tự.'});
  const folderId=req.body.folderId??null;
  if(folderId!==null && (!Number.isSafeInteger(folderId)||folderId<1))return res.status(400).json({error:'Thư mục không hợp lệ.'});
  if(folderId!==null && !await db.prepare('SELECT id FROM question_folders WHERE id=? AND owner_id=?').get(folderId,ownerId()))return res.status(404).json({error:'Không tìm thấy thư mục.'});
  const result=(await db.prepare('INSERT INTO question_sets (owner_id,name,folder_id) VALUES (?,?,?)').run(ownerId(),name,folderId));
  res.status(201).json({id:Number(result.lastInsertRowid),name,questionCount:0,folderId});
});
router.post('/bulk',async(req,res)=>{
  const {setIds,action,folderId}=req.body;
  if(req.body?.deleteQuestions!==undefined&&typeof req.body?.deleteQuestions!=='boolean')return res.status(400).json({error:'Tùy chọn xóa câu hỏi không hợp lệ.'});
  if(!Array.isArray(setIds)||!setIds.length||setIds.length>1000||!setIds.every(id=>Number.isSafeInteger(id)&&id>0)||!['move','delete'].includes(action)||(action==='move'&&folderId!==null&&(!Number.isSafeInteger(folderId)||folderId<1)))return res.status(400).json({error:'Danh sách bộ hoặc thao tác không hợp lệ.'});
  const ids=[...new Set(setIds)],marks=ids.map(()=>'?').join(',');
  const result=await db.transaction(async()=>{
    if(action==='move'&&folderId!==null&&!await db.prepare('SELECT id FROM question_folders WHERE id=? AND owner_id=?').get(folderId,ownerId()))return null;
    if((await db.prepare('SELECT COUNT(*) AS count FROM question_sets WHERE owner_id=? AND id IN ('+marks+')').get(ownerId(),...ids)).count!==ids.length)return null;
    let deletedQuestions=0;
    if(action==='delete'){
      if(req.body?.deleteQuestions===true)deletedQuestions=(await db.prepare('DELETE FROM questions WHERE owner_id=? AND set_id IN ('+marks+')').run(ownerId(),...ids)).changes;
      await db.prepare('DELETE FROM question_sets WHERE owner_id=? AND id IN ('+marks+')').run(ownerId(),...ids);
    }
    else await db.prepare('UPDATE question_sets SET folder_id=? WHERE owner_id=? AND id IN ('+marks+')').run(folderId,ownerId(),...ids);
    return {ok:true,count:ids.length,deletedQuestions};
  });
  if(!result)return res.status(404).json({error:'Không tìm thấy bộ hoặc thư mục thuộc tài khoản của bạn. Chưa thay đổi dữ liệu.'});
  res.json(result);
});
router.patch('/:id/folder',async(req,res)=>{
  const folderId=req.body.folderId;
  if(folderId!==null && (!Number.isSafeInteger(folderId)||folderId<1))return res.status(400).json({error:'Thư mục không hợp lệ.'});
  if(folderId!==null && !await db.prepare('SELECT id FROM question_folders WHERE id=? AND owner_id=?').get(folderId,ownerId()))return res.status(404).json({error:'Không tìm thấy thư mục.'});
  const result=await db.prepare('UPDATE question_sets SET folder_id=? WHERE id=? AND owner_id=?').run(folderId,Number(req.params.id),ownerId());
  if(!result.changes)return res.status(404).json({error:'Không tìm thấy bộ câu hỏi.'});
  res.json({ok:true});
});
router.patch('/:id', async (req,res) => {
  const name=typeof req.body.name==='string' ? req.body.name.trim() : '';
  if (!name || name.length>100) return res.status(400).json({error:'Tên bộ câu hỏi cần từ 1 đến 100 ký tự.'});
  const result=(await db.prepare('UPDATE question_sets SET name=? WHERE id=? AND owner_id=?').run(name,Number(req.params.id),ownerId()));
  if (!result.changes) return res.status(404).json({error:'Không tìm thấy bộ câu hỏi.'});
  res.json({ok:true});
});
router.delete('/:id', async (req,res) => {
  if(req.body?.deleteQuestions!==undefined&&typeof req.body?.deleteQuestions!=='boolean')return res.status(400).json({error:'Tùy chọn xóa câu hỏi không hợp lệ.'});
  const id=Number(req.params.id);
  const result=await db.transaction(async()=>{
    if(!await db.prepare('SELECT id FROM question_sets WHERE id=? AND owner_id=?').get(id,ownerId()))return null;
    let deletedQuestions=0;
    if(req.body?.deleteQuestions===true)deletedQuestions=(await db.prepare('DELETE FROM questions WHERE owner_id=? AND set_id=?').run(ownerId(),id)).changes;
    await db.prepare('DELETE FROM question_sets WHERE id=? AND owner_id=?').run(id,ownerId());
    return {ok:true,deletedQuestions};
  });
  if (!result) return res.status(404).json({error:'Không tìm thấy bộ câu hỏi.'});
  res.json(result);
});
router.patch('/contents/move', async (req,res) => {
  const {questionIds,setId}=req.body;
  if (!Array.isArray(questionIds) || !questionIds.length || !questionIds.every(id=>Number.isSafeInteger(id)&&id>0) || (setId!==null && (!Number.isSafeInteger(setId)||setId<1))) return res.status(400).json({error:'Danh sách câu hỏi hoặc bộ đích không hợp lệ.'});
  const ids=[...new Set(questionIds)];
  if(ids.length>10000)return res.status(413).json({error:'Mỗi lần di chuyển tối đa 10.000 câu. Hãy chia thành các lần nhỏ hơn; chưa có câu nào được chuyển.'});
  const result=await db.transaction(async()=>{
    if(setId!==null&&!await db.prepare('SELECT id FROM question_sets WHERE id=? AND owner_id=?').get(setId,ownerId()))return null;
    let count=0;
    for(let offset=0;offset<ids.length;offset+=1000){const chunk=ids.slice(offset,offset+1000);count+=(await db.prepare('SELECT COUNT(*) AS count FROM questions WHERE owner_id=? AND id IN ('+chunk.map(()=>'?').join(',')+')').get(ownerId(),...chunk)).count;}
    if(count!==ids.length)return null;
    let moved=0;
    for(let offset=0;offset<ids.length;offset+=1000){const chunk=ids.slice(offset,offset+1000);moved+=(await db.prepare('UPDATE questions SET set_id=? WHERE owner_id=? AND id IN ('+chunk.map(()=>'?').join(',')+') AND '+(setId===null?'set_id IS NOT NULL':'(set_id IS NULL OR set_id<>?)')).run(setId,ownerId(),...chunk,...(setId===null?[]:[setId]))).changes;}
    return {ok:true,moved,unchanged:ids.length-moved};
  });
  if(!result)return res.status(404).json({error:'Có câu hỏi hoặc bộ đích không thuộc tài khoản của bạn. Chưa di chuyển câu nào.'});
  res.json(result);
});
module.exports=router;
