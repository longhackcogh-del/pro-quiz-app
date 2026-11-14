// Input remains plain text; only delimited formulas are typeset, never trusted HTML.
function renderFormulaContent(element) {
  if(!element || !window.renderMathInElement)return;
  renderMathInElement(element,{
    delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'\\(',right:'\\)',display:false},{left:'$',right:'$',display:false}],
    throwOnError:false,trust:false,maxExpand:1000,maxSize:20,
    ignoredClasses:['katex','formula-source'],
    preProcess:formula=>'\\displaystyle '+formula.replace(/\\_(?=[\d{])/g,'_')
  });
}
function updateFormulaPreview(row) {
  let preview=row.querySelector('.formula-preview');
  if(!preview){preview=document.createElement('div');preview.className='formula-preview';row.querySelector('h4').after(preview);}
  preview.replaceChildren();
  for(const input of row.querySelectorAll('[data-prompt],[data-option]')){
    const line=document.createElement('div');line.textContent=input.hasAttribute('data-option')?String.fromCharCode(65+Number(input.dataset.option))+'. '+input.value:input.value;
    preview.append(line);
  }
  preview.hidden=!/[\\$]/.test(preview.textContent);
  if(!preview.hidden)renderFormulaContent(preview);
}
