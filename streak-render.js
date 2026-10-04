(()=>{
  'use strict';
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
  const KILLER_NAMES={
    doctor:'The Doctor',nightmare:'The Nightmare',artist:'The Artist',legion:'The Legion',twins:'The Twins',wraith:'The Wraith',
    nemesis:'The Nemesis',shape:'The Shape',animatronic:'The Animatronic',first:'The First',nurse:'The Nurse',onryo:'The Onryo',
    goodguy:'The Good Guy',hillbilly:'The Hillbilly',skullmerchant:'The Skull Merchant',theskullmerchant:'The Skull Merchant',xenomorph:'The Xenomorph',ghoul:'The Ghoul',
    slasher:'The Slasher',cenobite:'The Cenobite',hag:'The Hag',executioner:'The Executioner',unknown:'The Unknown',plague:'The Plague',
    dredge:'The Dredge',judgment:'The Judgment',spirit:'The Spirit',krasue:'The Krasue',deathslinger:'The Deathslinger',oni:'The Oni',
    cannibal:'The Cannibal',pig:'The Pig',trickster:'The Trickster',houndmaster:'The Houndmaster',lich:'The Lich',trapper:'The Trapper',
    demogorgon:'The Demogorgon',huntress:'The Huntress',singularity:'The Singularity',clown:'The Clown',ghostface:'Ghost Face',theghostface:'Ghost Face',
    knight:'The Knight',mastermind:'The Mastermind',darklord:'The Dark Lord',blight:'The Blight'
  };
  const SURVIVOR_NAMES={
    acevisconti:'Ace Visconti',adamfrancis:'Adam Francis',adawong:'Ada Wong',aestribaermar:'Aestri Yazar / Baermar Uraz',alanwake:'Alan Wake',
    ashleyjwilliams:'Ashley J. Williams',aurorastardotter:'Aurora Stardotter',billoverbeck:'William “Bill” Overbeck',cherylmason:'Cheryl Mason',
    claudettemorel:'Claudette Morel',davidking:'David King',davidtapp:'Detective David Tapp',dustinhenderson:'Dustin Henderson',dwightfairfield:'Dwight Fairfield',
    eleven:'Eleven',ellenripley:'Ellen Ripley',elodierakoto:'Élodie Rakoto',felixrichter:'Felix Richter',fengmin:'Feng Min',gabrielsoma:'Gabriel Soma',
    haddiekaur:'Haddie Kaur',jakepark:'Jake Park',janeromero:'Jane Romero',jeffjohansen:'Jeff Johansen',jillvalentine:'Jill Valentine',jonahvasquez:'Jonah Vasquez',
    katedenson:'Kate Denson',kwontaeyoung:'Kwon Tae-young',laracroft:'Lara Croft',lauriestrode:'Laurie Strode',leonscottkennedy:'Leon S. Kennedy',
    megthomas:'Meg Thomas',michonnegrimes:'Michonne Grimes',mikaelareid:'Mikaela Reid',nancywheeler:'Nancy Wheeler',neakarlsson:'Nea Karlsson',
    nicolascage:'Nicolas Cage',orelarose:'Orela Rose',quentinsmith:'Quentin Smith',rebeccachambers:'Rebecca Chambers',renatolyra:'Renato Lyra',
    rickgrimes:'Rick Grimes',sableward:'Sable Ward',shanewiigwaas:'Shane Wiigwaas',steveharrington:'Steve Harrington',tauriecain:'Taurie Cain',
    thalitalyra:'Thalita Lyra',trevorbelmont:'Trevor Belmont',veeboonyasak:'Vee Boonyasak',vittoriotoscano:'Vittorio Toscano',yoichiasakawa:'Yoichi Asakawa',
    yuikimura:'Yui Kimura',yunjinlee:'Yun-Jin Lee',zarinakassir:'Zarina Kassir'
  };
  function stem(file){return String(file||'').replace(/\.(png|jpe?g|webp)$/i,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()}
  function titleCase(v){return String(v||'').replace(/\b\w/g,c=>c.toUpperCase())}
  function displayName(file){const raw=stem(file),key=raw.replace(/\s+/g,'').toLowerCase();return KILLER_NAMES[key]||titleCase(raw)||'KILLER'}
  function survivorName(file){const raw=stem(file),key=raw.replace(/[^a-z0-9]/gi,'').toLowerCase();return SURVIVOR_NAMES[key]||titleCase(raw)||'SURVIVOR'}
  function killerUrl(file){return file?`http://127.0.0.1:17384/killer?name=${encodeURIComponent(file)}`:''}
  function survivorUrl(file){return file?`http://127.0.0.1:17384/survivor?name=${encodeURIComponent(file)}`:''}
  function ensure(root){
    if(root.dataset.built==='1')return;
    root.dataset.built='1';
    root.innerHTML=`
      <div class="streak-card">
        <div class="visual-side">
          <div class="visual-frame"></div>
          <img class="killer-img" alt="">
          <img class="survivor-img" alt="">
          <div class="visual-empty"><span>SURVIVOR</span></div>
        </div>
        <div class="streak-main">
          <div class="custom-line"></div>
          <div class="entity-name"></div>
          <div class="value-wrap"><div class="streak-value">0</div><div class="streak-pulse" aria-hidden="true">+1</div></div>
          <div class="record-chip"><span>RECORD</span><b>0</b></div>
        </div>
      </div>`;
  }
  function fitKillerName(el){
    if(!el)return;
    el.style.removeProperty('font-size');
    el.style.removeProperty('letter-spacing');
    // Start at the style's intended size, then only shrink when a long Killer name truly needs it.
    let size=parseFloat(getComputedStyle(el).fontSize)||24;
    let spacing=parseFloat(getComputedStyle(el).letterSpacing);if(!Number.isFinite(spacing))spacing=0;
    const min=15.5;
    while(el.scrollWidth>el.clientWidth+1&&size>min){
      size=Math.max(min,size-.5);
      el.style.fontSize=size+'px';
      if(size<20)el.style.letterSpacing=Math.max(.25,spacing-(20-size)*.08)+'px';
    }
  }
  function apply(root,state){
    const s=state?.streak||state||{};if(!root||!s)return;ensure(root);
    const accent=/^#[0-9a-f]{6}$/i.test(String(s.accent||''))?s.accent:'#f97316';
    const bg=/^#[0-9a-f]{6}$/i.test(String(s.bg1||''))?s.bg1:'#0d1118';
    const opacity=clamp(s.opacity??1,0,1);
    const shadowStrength=clamp(s.glow??70,0,100)/100;
    const shadowPower=shadowStrength*1.3;
    const mode=s.mode==='survivor'?'survivor':'killer';
    const style=Math.max(0,Math.min(3,Math.floor(Number(s.style)||0)));
    const survivorVisual=mode==='survivor'&&s.survivorVisual===true;
    root.className=`streak-widget style-${style+1} mode-${mode}${mode==='survivor'&&!survivorVisual?' survivor-visual-off':''}${survivorVisual?' survivor-visual-on':''}${s.pulsePending===true?' pulse-active':''}${opacity<=.001?' zero-opacity':''}`;
    root.style.setProperty('--accent',accent);
    const hex=bg.slice(1),n=parseInt(hex,16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;
    root.style.setProperty('--panel',`rgba(${r},${g},${b},${(.965*opacity).toFixed(3)})`);
    root.style.setProperty('--panel-soft',`rgba(${Math.min(255,r+17)},${Math.min(255,g+19)},${Math.min(255,b+24)},${(.925*opacity).toFixed(3)})`);
    root.style.setProperty('--border',`rgba(255,255,255,${(.14*opacity).toFixed(3)})`);
    root.style.setProperty('--text-filter',shadowStrength<=0?'none':`drop-shadow(0 1px ${(0.6+2.2*shadowPower).toFixed(2)}px rgba(0,0,0,${Math.min(.88,0.20+0.48*shadowPower).toFixed(3)}))`);
    root.style.setProperty('--white-glow',shadowStrength<=0?'none':`0 0 ${(2+6*shadowPower).toFixed(1)}px rgba(255,255,255,${Math.min(.46,0.12+0.25*shadowPower).toFixed(2)}),0 2px 5px rgba(0,0,0,.78)`);
    // Slightly stronger glow only for the Killer name / Survivor streak name. Top text and record keep the existing glow.
    root.style.setProperty('--entity-glow',shadowStrength<=0?'none':`0 0 ${(3+7.2*shadowPower).toFixed(1)}px rgba(255,255,255,${Math.min(.56,0.16+0.29*shadowPower).toFixed(2)}),0 2px 6px rgba(0,0,0,.80)`);
    // The shadow slider is text-only. Keep the overlay/card shadow fixed so borders and panels never change with this control.
    root.style.setProperty('--card-shadow','rgba(0,0,0,.34)');

    const killer=root.querySelector('.killer-img'),survivor=root.querySelector('.survivor-img'),empty=root.querySelector('.visual-empty');
    killer.style.display='none';survivor.style.display='none';empty.style.display='none';
    if(mode==='killer'){
      if(s.killerImage){killer.src=killerUrl(s.killerImage);killer.style.display='block'}
      else {killer.removeAttribute('src');empty.innerHTML='<span>KILLER</span>';empty.style.display='flex'}
    }else if(survivorVisual){
      if(s.survivorImage){survivor.src=survivorUrl(s.survivorImage);survivor.style.display='block'}
      else {survivor.removeAttribute('src');empty.innerHTML='<span>SURVIVOR</span>';empty.style.display='flex'}
    }

    const custom=String(mode==='survivor'?(s.survivorTopText??s.customText??''):(s.killerTopText??s.customText??'')).trim(),customEl=root.querySelector('.custom-line');
    customEl.textContent=custom;customEl.classList.toggle('empty',!custom);
    // Survivor images are purely visual. The selected Survivor name never replaces the editable streak label.
    const entity=root.querySelector('.entity-name');
    const entityText=mode==='killer'?displayName(s.killerImage):String(s.survivorStreakText||'WIN STREAK').trim()||'WIN STREAK';
    entity.textContent=entityText;
    entity.classList.toggle('long-name',mode==='killer'&&entityText.length>=15);
    entity.classList.toggle('very-long-name',mode==='killer'&&entityText.length>=18);
    if(mode==='killer')fitKillerName(entity);else{entity.style.removeProperty('font-size');entity.style.removeProperty('letter-spacing')}
    root.querySelector('.streak-value').textContent=String(Math.max(0,Math.floor(Number(s.value)||0)));
    root.querySelector('.record-chip b').textContent=String(Math.max(0,Math.floor(Number(s.recordValue)||0)));
    const pulse=root.querySelector('.streak-pulse');
    const pulseId=String(s.pulseId||'');
    if(s.pulsePending&&pulseId&&root.dataset.pulseId!==pulseId){
      root.dataset.pulseId=pulseId;
      pulse.textContent=`+${Math.max(1,Math.floor(Number(s.pulseDelta)||1))}`;
      pulse.classList.remove('play');
      void pulse.offsetWidth;
      pulse.classList.add('play');
    }else if(!s.pulsePending){
      pulse.classList.remove('play');
    }
  }
  window.StreakRenderer={apply,displayName,survivorName};
})();
