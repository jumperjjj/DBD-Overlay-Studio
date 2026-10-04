(()=>{
  'use strict';
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function displayName(file){
    const stem=String(file||'').replace(/\.(png|jpe?g|webp)$/i,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
    return stem || 'KILLER';
  }
  function killerUrl(file){return file?`http://127.0.0.1:17384/killer?name=${encodeURIComponent(file)}`:''}
  function ensure(root){
    if(root.dataset.built==='1')return;
    root.dataset.built='1';
    root.innerHTML=`<div class="streak-card"><div class="killer-side"><img class="killer-img" alt=""><div class="killer-empty">KILLER</div><div class="survivor-mark"><span>SURVIVOR</span></div></div><div class="streak-main"><div class="custom-line"></div><div class="entity-name"></div><div class="win-label">WIN STREAK</div><div class="streak-value">0</div><div class="record-chip"><span>RECORD</span><b>0</b></div></div></div>`;
  }
  function apply(root,state){
    const s=state?.streak||state||{};if(!root||!s)return;ensure(root);
    const accent=/^#[0-9a-f]{6}$/i.test(String(s.accent||''))?s.accent:'#3b82f6';
    const bg=/^#[0-9a-f]{6}$/i.test(String(s.bg1||''))?s.bg1:'#0d0e13';
    const opacity=clamp(s.opacity??1,0,1);
    const shadowStrength=clamp(s.glow??20,0,100)/100;
    const mode=s.mode==='survivor'?'survivor':'killer';
    root.className=`streak-widget${opacity<=.001?' zero-opacity':''}`;
    root.style.setProperty('--accent',accent);
    const hex=bg.slice(1),n=parseInt(hex,16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;
    root.style.setProperty('--panel',`rgba(${r},${g},${b},${(.98*opacity).toFixed(3)})`);
    root.style.setProperty('--panel-soft',`rgba(${Math.min(255,r+14)},${Math.min(255,g+16)},${Math.min(255,b+20)},${(.94*opacity).toFixed(3)})`);
    root.style.setProperty('--border',`rgba(255,255,255,${(.14*opacity).toFixed(3)})`);
    root.style.setProperty('--text-filter',shadowStrength<=0?'none':`drop-shadow(0 1px ${(0.7+2.0*shadowStrength).toFixed(2)}px rgba(0,0,0,${(0.14+0.46*shadowStrength).toFixed(3)}))`);
    const card=root.querySelector('.streak-card');card.classList.toggle('mode-survivor',mode==='survivor');
    const img=root.querySelector('.killer-img'),empty=root.querySelector('.killer-empty');
    if(mode==='killer'&&s.killerImage){img.src=killerUrl(s.killerImage);img.style.display='block';empty.style.display='none'}else if(mode==='killer'){img.removeAttribute('src');img.style.display='none';empty.style.display='flex'}
    const custom=String(s.customText||'').trim(),customEl=root.querySelector('.custom-line');customEl.innerHTML=esc(custom);customEl.classList.toggle('empty',!custom);
    root.querySelector('.entity-name').textContent=mode==='killer'?displayName(s.killerImage):'SURVIVOR';
    root.querySelector('.streak-value').textContent=String(Math.max(0,Math.floor(Number(s.value)||0)));
    root.querySelector('.record-chip b').textContent=String(Math.max(0,Math.floor(Number(s.recordValue)||0)));
  }
  window.StreakRenderer={apply,displayName};
})();
