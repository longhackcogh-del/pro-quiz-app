const MAX_EXPANDED=32*1024*1024,MAX_TEXT=12*1024*1024;
function checkDocx(buffer){
  return new Promise((resolve,reject)=>{
    require('yauzl').fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
      if(error)return reject(error);
      let declared=0,actual=0,entries=0,done=false,stream;
      const fail=error=>{if(done)return;done=true;stream?.destroy();zip.close();reject(error);};
      zip.on('error',fail);
      zip.on('entry',entry=>{
        if(done)return;
        declared+=entry.uncompressedSize;
        if(++entries>2000||declared>MAX_EXPANDED)return fail(Object.assign(new Error(),{code:'DOCUMENT_LIMIT'}));
        if(entry.generalPurposeBitFlag&1)return fail(new Error('Encrypted archive'));
        if(entry.fileName.endsWith('/'))return zip.readEntry();
        zip.openReadStream(entry,(error,input)=>{
          if(error)return fail(error);if(done){input.destroy();return;}stream=input;
          input.on('error',fail);
          input.on('data',chunk=>{actual+=chunk.length;if(actual>MAX_EXPANDED)fail(Object.assign(new Error(),{code:'DOCUMENT_LIMIT'}));});
          input.on('end',()=>{if(!done)zip.readEntry();});
        });
      });
      zip.on('end',()=>{if(!done){done=true;resolve();}});zip.readEntry();
    });
  });
}
process.once('message',async workerData=>{
  try{
    const buffer=Buffer.from(workerData.buffer);let text;
    if(workerData.extension==='.docx'){
      await checkDocx(buffer);text=(await require('mammoth').extractRawText({buffer})).value;
    }else if(workerData.extension==='.pdf'){
      const {PDFParse}=require('pdf-parse');const parser=new PDFParse({data:buffer});
      try{
        const info=await parser.getInfo({parsePageInfo:false});
        if(info.total>300)throw Object.assign(new Error(),{code:'DOCUMENT_LIMIT'});
        text=(await parser.getText()).text;
      }finally{await parser.destroy();}
    }else throw Error('Unsupported document');
    if(Buffer.byteLength(text,'utf8')>MAX_TEXT)throw Object.assign(new Error(),{code:'DOCUMENT_LIMIT'});
    process.send({text});
  }catch(error){process.send({error:error.code==='DOCUMENT_LIMIT'?'DOCUMENT_LIMIT':'DOCUMENT_INVALID'});}
});
