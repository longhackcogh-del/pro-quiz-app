module.exports=(app,db)=>{
  app.get('/api/feedback',async(req,res)=>{
    res.set('Cache-Control','no-store');
    const before=req.query.before===undefined?null:Number(req.query.before);
    if(before!==null && (!Number.isSafeInteger(before)||before<1))return res.status(400).json({error:'Trang phản hồi không hợp lệ.'});
    const rows=await db.prepare('SELECT id,author_name,content,created_at FROM feedback'+(before===null?'':' WHERE id<?')+' ORDER BY id DESC LIMIT 21').all(...(before===null?[]:[before]));
    const items=rows.slice(0,20).map(row=>({id:row.id,name:row.author_name,content:row.content,createdAt:row.created_at}));
    res.json({items,nextCursor:rows.length>20?items.at(-1).id:null});
  });
  app.post('/api/feedback',async(req,res)=>{
    const content=typeof req.body?.content==='string'?req.body.content.trim():'';
    if(!content || content.length>2000)return res.status(400).json({error:'Phản hồi cần từ 1 đến 2.000 ký tự.'});
    const row=await db.prepare('INSERT INTO feedback (owner_id,author_name,content) VALUES (?,?,?) RETURNING id,author_name,content,created_at').get(req.user.id,req.user.name,content);
    res.status(201).json({id:row.id,name:row.author_name,content:row.content,createdAt:row.created_at});
  });
};
