const KINDS = ['ranking','achievements','collection','legendary','mythic'];
const defaults = kind => ({ enabled:'1', bg:'#0b1825', text:'#ffffff', accent:kind==='mythic'?'#cb8aff':kind==='legendary'?'#ffd05c':'#70e0c5', opacity:'94', width:['legendary','mythic'].includes(kind)?'1280':'640', height:['legendary','mythic'].includes(kind)?'720':'480', duration:['legendary','mythic'].includes(kind)?'6':'10', columns:'4', icon_size:['legendary','mythic'].includes(kind)?'180':'56', image_scale:'100', radius:'18', x:'50', y:'50', scale:'100', layout:['legendary','mythic'].includes(kind)?'cinematic':kind==='ranking'?'table':'cards', earned_only:'1', title:kind==='legendary'?'CAPTURA LENDÁRIA':kind==='mythic'?'ENCONTRO MÍTICO':'' });
function readStyle(db,kind) {
  return Object.fromEntries(Object.entries(defaults(kind)).map(([key,value])=>[key,db.getSetting(`${kind}_overlay_${key}`,value)]));
}
function validateStyle(kind,body) {
  if(!KINDS.includes(kind))throw new Error('Overlay inválido.');
  const result={};
  const ranges={opacity:[0,100],width:[320,1920],height:[180,1080],duration:[1,60],columns:[1,8],icon_size:[24,320],image_scale:[50,300],radius:[0,48],x:[0,100],y:[0,100],scale:[30,150]};
  for(const [key,value] of Object.entries(body)) {
    if(!(key in defaults(kind)))continue;
    const text=String(value);
    if(ranges[key]&&(!text.trim()||!Number.isFinite(Number(value))||Number(value)<ranges[key][0]||Number(value)>ranges[key][1]))throw new Error('Valor inválido: '+key);
    if(['width','height','columns','icon_size'].includes(key)&&!Number.isInteger(Number(value)))throw new Error('Use número inteiro: '+key);
    if(['bg','text','accent'].includes(key)&&!/^#[0-9a-f]{6}$/i.test(text))throw new Error('Cor inválida.');
    if(['enabled','earned_only'].includes(key)&&!['0','1'].includes(text))throw new Error('Opção inválida.');
    if(key==='layout'&&!(['ranking'].includes(kind)?['table','podium']:['legendary','mythic'].includes(kind)?['cinematic','spotlight']:['cards','compact']).includes(text))throw new Error('Modelo inválido.');
    if(key==='title'&&text.length>80)throw new Error('Use um título de até 80 caracteres.');
    result[key]=text;
  }
  return result;
}
module.exports={KINDS,defaults,readStyle,validateStyle};
