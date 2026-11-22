// Limits are shared by routes using the same guard. Work stays counted until
// its promise settles, even if a client disconnects in the middle of a request.
function workGuard({requests,concurrency,perUser=1,windowMs=60000},now=Date.now){
  const windows=new Map(),activeUsers=new Map();let active=0;
  return handler=>async(req,res)=>{
    const user=req.user?.id;if(!user)return res.status(401).json({error:'Bạn cần đăng nhập để thực hiện thao tác này.'});
    const time=now();let window=windows.get(user);
    if(requests && (!window||window.until<=time)){
      for(const [id,item] of windows)if(item.until<=time)windows.delete(id);
      window={count:0,until:time+windowMs};windows.set(user,window);
    }
    if(requests && window.count>=requests)return res.set('Retry-After',String(Math.max(1,Math.ceil((window.until-time)/1000)))).status(429).json({error:'Bạn gửi yêu cầu quá nhanh. Hãy đợi một lát rồi thử lại.'});
    if((activeUsers.get(user)||0)>=perUser)return res.set('Retry-After','2').status(429).json({error:'Yêu cầu trước của bạn đang được xử lý. Hãy đợi hoàn tất.'});
    if(active>=concurrency)return res.set('Retry-After','2').status(503).json({error:'Hệ thống đang xử lý nhiều yêu cầu. Hãy thử lại sau ít giây.'});
    if(requests)window.count++;
    active++;activeUsers.set(user,(activeUsers.get(user)||0)+1);
    try{return await handler(req,res);}finally{active--;const left=activeUsers.get(user)-1;if(left)activeUsers.set(user,left);else activeUsers.delete(user);}
  };
}
module.exports={workGuard};
