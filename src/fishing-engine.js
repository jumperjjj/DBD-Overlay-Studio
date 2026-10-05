class FishingEngine {
  constructor(database, broadcast) {
    this.db = database;
    this.broadcast = broadcast;
    this.queue = Promise.resolve();
    this.pending = new Set();
    this.onResult = null;
    this.interPlayerDelayMs = 3000;
  }

  pickByChance(items) {
    const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.chance || 0)), 0);
    if (!items.length || !Number.isFinite(total) || total <= 0) return null;

    let roll = Math.random() * total;
    for (const item of items) {
      roll -= Math.max(0, Number(item.chance || 0));
      if (roll < 0) return item;
    }
    return items[items.length - 1];
  }

  randomGold(item) {
    const min = Math.max(0, Math.floor(Number(item.gold_min) || 0));
    const max = Math.max(min, Math.floor(Number(item.gold_max) || min));
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async fish({ channelId, user, bypassCooldown = false }) {
    const settings = this.db.getSettings();
    const baseCooldown=Math.max(0,Number(settings.cooldown_seconds ?? 120));
    const cooldownMs=(this.events?this.events.cooldown(channelId,baseCooldown):baseCooldown)*1000;
    const player = this.db.ensurePlayer(channelId, user);
    const elapsed = Date.now() - Number(player.last_fished_at || 0);

    const key = JSON.stringify([channelId, user.id]);
    if (this.pending.has(key)) {
      return { ok: false, reason: 'cooldown', remainingSeconds: Math.max(0, Math.ceil((cooldownMs - elapsed) / 1000)), pending: true };
    }
    if (!bypassCooldown && elapsed < cooldownMs) {
      return {
        ok: false,
        reason: 'cooldown',
        remainingSeconds: Math.ceil((cooldownMs - elapsed) / 1000)
      };
    }

    const items = this.db.getFishingItems();
    const chanceTotal = items.reduce((sum, item) => sum + Number(item.chance || 0), 0);
    if (!items.length) return { ok: false, reason: 'no_items' };
    if (!Number.isFinite(chanceTotal) || chanceTotal <= 0) {
      return { ok: false, reason: 'invalid_chance_total', chanceTotal };
    }

    // Reserva o cooldown imediatamente para impedir spam enquanto a animação está na fila.
    this.db.markFishingStarted(channelId, user);
    this.pending.add(key);

    const job = async () => {
      const latestSettings = this.db.getSettings();
      const fishingMs = Math.max(0, Number(latestSettings.fishing_seconds ?? 4)) * 1000;
      const activeEvent=this.events?.active(channelId);
      const originalItems=this.db.getFishingItems();
      const latestItems=this.events?this.events.items(channelId,originalItems,activeEvent):originalItems;
      const item = this.pickByChance(latestItems);
      if (!item) return { ok: false, reason: 'invalid_chance_total', chanceTotal: this.db.getChanceTotal() };

      this.broadcast({ type: 'fishing:start', user, durationMs: fishingMs });
      await new Promise((resolve) => setTimeout(resolve, fishingMs));

      // Sincroniza metas já alcançadas antes desta captura sem repetir avisos.
      this.db.unlockAchievements(channelId, user.id);
      const baseGold=this.randomGold(item);
      const isCursed=item.rarity==='Amaldiçoado';
      const requestedGold=isCursed?-baseGold:(this.events?this.events.gold(channelId,baseGold,activeEvent):baseGold);
      let goldAwarded=requestedGold;
      const updatedPlayer = this.db.applyCatch(channelId, user, item, goldAwarded);
      goldAwarded=updatedPlayer.gold_delta;
      const payload = {
        type: 'fishing:result',
        user,
        item: {
          ...item,
          goldAwarded,
          isCursed
        },
        player: {
          gold: updatedPlayer.gold,
          totalCatches: updatedPlayer.total_catches
        }
      };
      const achievements = this.db.unlockAchievements(channelId, user.id);
      const achievementEpoch = this.db.getAchievementEpoch(channelId, user.id);
      const resultMs = Number(latestSettings.overlay_result_seconds ?? 5.2) * 1000;
      let specialMs=0;
      const kind=item.rarity==='Lendário'?'legendary':item.rarity==='Mítico'?'mythic':null;
      if(kind) {
        const style=require('./overlay-options').readStyle(this.db,kind);
        if(style.enabled!=='0') {
          specialMs=Number(style.duration)*1000+350;
          payload.special={kind,style,transitionMs:350};
        }
      }
      payload.durationMs = specialMs || resultMs;
      payload.achievements = achievements;
      this.broadcast(payload);
      if(payload.special) this.broadcast({type:'special:catch',kind,user,item:payload.item,style:payload.special.style,durationMs:specialMs,presentation:'fishing'});
      if (!bypassCooldown && this.onResult) {
        Promise.resolve().then(() => this.onResult({ ok: true, ...payload }))
          .catch(error => this.broadcast({ type: 'twitch:error', message: error.message || String(error) }));
      }
      await new Promise(resolve => setTimeout(resolve, (specialMs || resultMs) + 250));
      if (latestSettings.achievement_overlay_enabled !== '0') {
        for (const achievement of achievements) {
          if (this.db.getAchievementEpoch(channelId, user.id) !== achievementEpoch) break;
          const durationMs = Number(latestSettings.achievement_seconds ?? 4) * 1000;
          this.broadcast({ type: 'achievement:unlocked', user, achievement, durationMs });
          await new Promise(resolve => setTimeout(resolve, durationMs + 250));
        }
      }
      await new Promise(resolve => setTimeout(resolve, this.interPlayerDelayMs));
      return { ok: true, ...payload };
    };

    const run = async () => { try { return await job(); } finally { this.pending.delete(key); } };
    const resultPromise = this.queue.then(run, run);
    this.queue = resultPromise.catch(() => {});
    return resultPromise;
  }
}

module.exports = { FishingEngine };
