const {fork}=require('node:child_process');
const path=require('node:path');
function documentError(code){
  const limited=code==='DOCUMENT_LIMIT';
  return Object.assign(new Error(limited?'Tài liệu vượt mức xử lý an toàn. Hãy chia nhỏ file (DOCX giải nén tối đa 32 MB, PDF tối đa 300 trang).':'Không thể đọc tài liệu. Tệp có thể bị lỗi, được mã hóa hoặc xử lý quá lâu. Hãy kiểm tra và chia nhỏ tệp.'),{status:limited?413:422});
}
function extractDocument(buffer,extension){
  return new Promise((resolve,reject)=>{
    const worker=fork(path.join(__dirname,'document-worker.js'),[],{env:process.platform==='win32'?{SystemRoot:process.env.SystemRoot}:{},execArgv:['--max-old-space-size=128'],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
    let settled=false,exited=false;
    const finish=(error,text)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      // Keep the upload slot occupied until the parser process is actually gone.
      const complete=()=>error?reject(error):resolve(text);
      if(exited||!worker.pid)return complete();
      worker.once('exit',complete);worker.kill('SIGKILL');
    };
    const timer=setTimeout(()=>finish(documentError()),15000);
    worker.once('message',message=>finish(message.error?documentError(message.error):null,message.text));
    worker.once('error',()=>finish(documentError()));
    worker.once('exit',()=>{exited=true;if(!settled)finish(documentError());});
    worker.send({buffer,extension},error=>{if(error)finish(documentError());});
  });
}
module.exports={extractDocument};
