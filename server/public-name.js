function publicName(value){
  const name=typeof value==='string'?value.trim():'';
  return !name || name.includes('@') ? 'Người học' : name.slice(0,150);
}
module.exports={publicName};
