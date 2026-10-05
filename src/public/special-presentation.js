window.SpecialPresentation = (() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function html(data,style,kind) {
    const image=data.item?.image_path?`<img src="${esc(data.item.image_path)}" alt=""/>`:(kind==='mythic'?'🔱':'👑');
    return `<div class="aura"></div><div class="heading">${esc(style.title||(kind==='mythic'?'ENCONTRO MÍTICO':'CAPTURA LENDÁRIA'))}</div><div class="special-icon">${image}</div><div class="special-name">${esc(data.item?.name)}</div><div class="special-user">${esc(data.user?.displayName||data.user?.login)} encontrou algo especial!</div><div class="special-gold">+${Number(data.item?.goldAwarded||0).toLocaleString('pt-BR')} OURO</div>`;
  }
  function styleBoard(board,style) {
    const bg=style.bg||'#0b1825';
    board.style.setProperty('--bg',`rgba(${parseInt(bg.slice(1,3),16)},${parseInt(bg.slice(3,5),16)},${parseInt(bg.slice(5,7),16)},${Number(style.opacity??94)/100})`);
    board.style.setProperty('--text',style.text||'#fff');board.style.setProperty('--accent',style.accent||'#ffd05c');
    board.style.setProperty('--radius',(style.radius??18)+'px');
    board.style.setProperty('--icon',(Number(style.icon_size||180)*Number(style.image_scale||100)/100)+'px');
  }
  return {html,styleBoard};
})();
