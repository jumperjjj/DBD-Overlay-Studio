(function(root){
  const icons={catches:'🎣',gold:'🪙',collection:'📘',unique_items:'🐠',item_count:'🐟',rarity_count:'💎',rarity_streak:'🔥',total_gold:'💰',biggest_gold:'👑',fishing_days:'📅',daily_catches:'🪝',daily_gold:'🏦',rarity_variety:'🌈',lost_gold:'🕸️'};
  const api={icon:metric=>icons[metric]||'🏆'};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FishingVisuals=api;
})(typeof globalThis==='object'?globalThis:this);
