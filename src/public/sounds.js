/* Short synthesized fanfares: no downloads, polling or persistent audio nodes. */
window.FishingSounds = (() => {
  let context;
  const scores = {
    legendary: { type:'triangle', notes:[523.25,659.25,783.99,1046.5], step:.11, decay:.36 },
    mythic: { type:'sine', notes:[329.63,493.88,659.25,987.77,1318.51], step:.15, decay:.55 }
  };
  function playSpecial(kind) {
    const score=scores[kind]; if(!score)return;
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      const start=() => {
        const now=context.currentTime;
        score.notes.forEach((frequency,index)=>{
          const at=now+index*score.step;
          const oscillator=context.createOscillator(), gain=context.createGain();
          oscillator.type=score.type;oscillator.frequency.setValueAtTime(frequency,at);
          gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.1,at+.018);
          gain.gain.exponentialRampToValueAtTime(.0001,at+score.decay);
          oscillator.connect(gain).connect(context.destination);
          oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
          oscillator.start(at);oscillator.stop(at+score.decay+.02);
        });
      };
      if(context.state==='suspended')context.resume().then(start).catch(()=>{});else start();
    } catch {}
  }
  return {playSpecial};
})();
