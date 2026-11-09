// Small real documents exercise the existing extraction libraries, without external files.
async function docx(text) {
  const JSZip = require('jszip'); // Already installed by mammoth.
  const zip = new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+text.split('\n').map(line=>'<w:p><w:r><w:t>'+line.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>');
  return zip.generateAsync({type:'nodebuffer'});
}
function pdf(text) {
  const content = 'BT /F1 12 Tf 50 750 Td '+text.split('\n').map((line,index)=>(index ? '0 -18 Td ' : '')+'('+line.replace(/[\\()]/g,'\\$&')+') Tj').join('\n')+' ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object,index)=> { offsets.push(Buffer.byteLength(output)); output+=`${index+1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
module.exports = {docx,pdf};
