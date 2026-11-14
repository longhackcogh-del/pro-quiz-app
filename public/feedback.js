let feedbackCursor=null,feedbackLoading=false,feedbackSending=false,feedbackGeneration=0;
function appendFeedback(items) {
  for(const item of items){
    const card=document.createElement('article');card.className='panel feedback-card';card.dataset.feedbackId=item.id;
    const name=document.createElement('strong');name.textContent=item.name;
    const time=document.createElement('time');time.dateTime=item.createdAt;time.textContent=new Date(item.createdAt.includes('T')?item.createdAt:item.createdAt.replace(' ','T')+'Z').toLocaleString('vi-VN');
    const content=document.createElement('p');content.textContent=item.content;
    card.append(name,time,content);$('#feedback-list').append(card);
  }
}
async function openFeedback(){
  setView('v-feedback');$('#view-title').textContent='Phản hồi cộng đồng';
  $('#feedback-status').textContent=state.accountId?'':'Bạn có thể đọc mọi phản hồi. Đăng nhập Google để gửi phản hồi.';
  feedbackGeneration++;feedbackLoading=false;feedbackCursor=null;
  $('#feedback-list').replaceChildren();$('#feedback-more').hidden=true;
  await loadMoreFeedback();
}
async function loadMoreFeedback(){
  if(feedbackLoading)return;feedbackLoading=true;
  const generation=feedbackGeneration;
  $('#feedback-more').disabled=true;
  try{
    const result=await api('/api/feedback'+(feedbackCursor?'?before='+feedbackCursor:''));
    if(generation!==feedbackGeneration)return;
    appendFeedback(result.items);feedbackCursor=result.nextCursor;$('#feedback-more').hidden=!feedbackCursor;
    if(!$('#feedback-list').children.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Chưa có phản hồi. Hãy chia sẻ góp ý đầu tiên!';$('#feedback-list').append(empty);}
  }catch(error){showError(error);}finally{if(generation===feedbackGeneration){feedbackLoading=false;$('#feedback-more').disabled=false;}}
}
async function submitFeedback(event){
  event.preventDefault();if(feedbackSending)return;
  if(!state.accountId){openLogin(true);return;}
  const input=$('#feedback-content'),content=input.value.trim();
  if(!content)return input.focus();
  feedbackSending=true;$('#feedback-submit').disabled=true;$('#feedback-status').textContent='Đang gửi…';
  try{await api('/api/feedback',post({content}));input.value='';await openFeedback();$('#feedback-status').textContent='Đã đăng phản hồi công khai.';}
  catch(error){$('#feedback-status').textContent='Chưa gửi được. Nội dung được giữ lại để thử lại.';showError(error);}
  finally{feedbackSending=false;$('#feedback-submit').disabled=false;}
}
