const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let settings = {};
let itemCache = [];
let playersCache = [];
let editingItemId = null;
let creatingItem = false;
let editorImageData = '';
let editorRemoveImage = false;
let editingRankUserId = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Erro ${response.status}`);
  return body;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function escapeAttr(value) { return escapeHtml(value); }

function formatChance(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

function formatNumber(value) { return Number(value || 0).toLocaleString('pt-BR'); }

function rarityClass(rarity) {
  const key = String(rarity || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return `rarity-${key}`;
}

function updateChanceSummary(total) {
  const rounded = Math.round(Number(total || 0) * 100) / 100;
  $('#chanceTotal').textContent = rounded > 0 ? 'Pronto' : 'Sem chances';
  const ok = rounded > 0;
  $('#chanceTotal').className = ok ? 'chance-ok' : 'chance-bad';
  $('#chanceHint').textContent = ok ? 'Chances calculadas automaticamente, sem limite de total.' : 'Adicione pelo menos um item com chance maior que zero.';
  $('#chanceHint').className = ok ? 'chance-hint ok' : 'chance-hint';
}

async function loadStatus() {
  const data = await api('/api/status');
  settings = data.settings || {};

  $('#clientId').value = settings.twitch_client_id || '';
  $('#targetChannel').value = settings.target_channel_login || '';
  $('#expectedBotLogin').value = settings.expected_bot_login || 'fishingbotjjj';
  $('#command').value = settings.command || '!pescar';
  $('#cooldown').value = settings.cooldown_seconds ?? '120';
  $('#fishingSeconds').value = settings.fishing_seconds ?? '4';
  $('#resultSeconds').value = settings.overlay_result_seconds ?? '5.2';
  $('#achievementSeconds').value = settings.achievement_seconds ?? '4';
  $('#pendingTemplate').value = settings.chat_pending_template || '@{user}, sua pescaria ainda está na fila ou em exibição. Aguarde o resultado!';
  $('#overlayEnabled').checked = settings.overlay_enabled !== '0';
  $('#achievementOverlayEnabled').checked = settings.achievement_overlay_enabled !== '0';
  $('#chatResultEnabled').checked = settings.chat_result_enabled !== '0';
  $('#chatCooldownEnabled').checked = settings.chat_cooldown_enabled !== '0';
  $('#resultTemplate').value = settings.chat_result_template || '🎣 @{user} trouxe {item} da água! +{ouro} ouro • coleção em progresso.';
  $('#cooldownTemplate').value = settings.chat_cooldown_template || '⏳ @{user}, sua próxima pescaria estará disponível em {tempo}.';

  $('#overlaySound').checked = settings.overlay_sound_enabled !== '0';
  $('#overlayShowImage').checked = settings.overlay_show_image !== '0';
  $('#overlayBg').value = settings.overlay_bg_color || '#07131d';
  $('#overlayText').value = settings.overlay_text_color || '#ffffff';
  $('#overlayAccent').value = settings.overlay_accent_color || '#70e0c5';
  $('#overlayGold').value = settings.overlay_gold_color || '#ffd45f';
  $('#overlayOpacity').value = settings.overlay_opacity || '90';
  $('#overlayX').value = settings.overlay_x || '50';
  $('#overlayY').value = settings.overlay_y || '86';
  $('#overlayScale').value = settings.overlay_scale || '100';
  $('#cursedTemplate').value=settings.chat_cursed_template||'🕸️ @{user} pescou {item} e perdeu {ouro} ouro. Saldo: {ouro_total}.';
  $('#overlayImageScale').value=settings.overlay_image_scale||'100';
  $('#overlayImageSize').value = settings.overlay_image_size || '72';
  $('#overlayRadius').value = settings.overlay_radius || '16';
  $('#overlayAnimation').value = settings.overlay_animation || 'pop';
  $('#overlayLayout').value = settings.overlay_layout || 'classic';
  $('#overlayWidth').value = settings.overlay_width || '640';
  $('#overlayHeight').value = settings.overlay_height || '360';
  $('#overlayUrl').textContent = data.overlayUrl;

  $('#summaryPlayers').textContent = formatNumber(data.summary?.players || 0);
  $('#summaryCatches').textContent = formatNumber(data.summary?.catches || 0);
  $('#summaryItems').textContent = formatNumber(data.summary?.items || 0);
  $('#quickCommand').textContent = settings.command || '!pescar';
  $('#quickCooldown').textContent = `${settings.cooldown_seconds ?? 120}s`;

  setBotConnected(Boolean(data.twitchConnected));
  if (data.twitchConnected && settings.bot_user_name && settings.active_channel_name) {
    $('#twitchStatus').className = 'status online';
    $('#twitchStatus').textContent = `● Bot ${settings.bot_user_name} → ${settings.active_channel_name}`;
  }

  updateCooldownExample();
  updateOverlayPreview();
}

function itemRowsHtml() {
  if (!itemCache.length) return '<tr><td colspan="6" class="muted">Nenhum item cadastrado.</td></tr>';
  return itemCache.map((item) => `
    <tr class="item-row" data-id="${item.id}">
      <td class="thumb-cell"><div class="item-thumb-controls"><input class="item-enabled" type="checkbox" data-id="${item.id}" ${item.enabled?'checked':''} aria-label="Habilitar ${escapeAttr(item.name)}" title="Participa das pescarias"/>${item.image_path ? `<img class="item-thumb" src="${escapeAttr(item.image_path)}" alt="" />` : '<div class="item-thumb placeholder">🎣</div>'}</div></td>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td><span class="rarity-pill ${rarityClass(item.rarity)}">${escapeHtml(item.rarity)}</span></td>
      <td>${formatChance(item.chance)}<div class="muted tiny">Efetiva: ${formatChance((item.enabled?item.chance:0) / Math.max(1e-10,itemCache.reduce((sum,i)=>sum+(i.enabled?Number(i.chance):0),0))*100)}</div></td>
      <td>${item.rarity==='Amaldiçoado'?'−':''}${formatNumber(item.gold_min)}–${formatNumber(item.gold_max)}</td>
      <td class="actions-cell"><button class="small edit-item" data-id="${item.id}">Editar</button></td>
    </tr>
  `).join('');
}

async function loadItems({ preserveEditor = false } = {}) {
  const data = await api('/api/items');
  itemCache = data.items || [];
  updateChanceSummary(data.chanceTotal);
  $('#itemsBody').innerHTML = itemRowsHtml();
  $$('.edit-item').forEach((button) => button.addEventListener('click', () => openItemEditor(Number(button.dataset.id))));

  $$('.item-enabled').forEach(input=>input.addEventListener('change',async()=>{const enabled=input.checked;input.disabled=true;try{await api('/api/items/'+input.dataset.id+'/enabled',{method:'PATCH',body:JSON.stringify({enabled})});await loadItems({preserveEditor:true});showEvent(enabled?'Item habilitado.':'Item desabilitado.');}catch(error){input.checked=!enabled;showEvent(error.message);}finally{input.disabled=false;}}));
  if (preserveEditor && (creatingItem || editingItemId)) insertItemEditor();
  updateOverlayPreview();
}

function editorTemplate(item) {
  const currentImage = editorImageData || (!editorRemoveImage ? item?.image_path : '');
  return `
    <tr class="inline-editor-row">
      <td colspan="6">
        <div class="inline-editor">
          <div class="inline-editor-top">
            <div class="image-editor-block">
              <div class="editor-image-preview">${currentImage ? `<img id="editorImagePreview" src="${escapeAttr(currentImage)}" alt="" />` : '<span id="editorImageEmpty">SEM IMAGEM</span>'}</div>
              <div class="image-actions">
                <label class="file-button">Escolher imagem<input id="itemImageInput" type="file" accept="image/png,image/jpeg,image/webp" hidden /></label>
                <button id="removeItemImage" class="small" type="button">Remover</button>
                <span class="muted tiny">Redimensionada automaticamente para até 160×160.</span>
              </div>
            </div>
            <button id="closeInlineEditor" class="icon-button" title="Fechar">×</button>
          </div>

          <div class="inline-fields">
            <div class="field span-2"><label>Nome</label><input id="itemName" value="${escapeAttr(item?.name || '')}" placeholder="Ex.: Sardinha" /></div>
            <div class="field"><label>Raridade</label>
              <select id="itemRarity">
                ${['Lixo','Comum','Raro','Épico','Lendário','Mítico','Amaldiçoado'].map((rarity) => `<option ${item?.rarity === rarity ? 'selected' : ''}>${rarity}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Chance relativa (%)</label><input id="itemChance" type="number" min="0" max="1000000" step="0.01" value="${Number(item?.chance || 0)}" /></div>
            <div class="field"><label id="goldMinLabel">Ouro mín.</label><input id="itemGoldMin" type="number" min="0" value="${Number(item?.gold_min ?? 10)}" /></div>
            <div class="field"><label id="goldMaxLabel">Ouro máx.</label><input id="itemGoldMax" type="number" min="0" value="${Number(item?.gold_max ?? 20)}" /></div>
          </div>

          <p id="cursedItemHint" class="muted tiny"></p>
          <label>Mensagem própria do bot <span class="muted">(opcional)</span></label>
          <textarea id="itemMessageTemplate" rows="2" placeholder="Vazio = usa a mensagem padrão dos Comandos">${escapeHtml(item?.message_template || '')}</textarea>
          <div class="inline-vars"><span>Variáveis:</span> <code>{user}</code> <code>{item}</code> <code>{raridade}</code> <code>{ouro}</code> <code>{ouro_total}</code> <code>{pescarias}</code></div>
          <div class="row compact-row">
            <button id="saveItem" class="primary">Salvar</button>
            ${item ? '<button id="deleteItem" class="danger">Excluir</button>' : ''}
            <button id="cancelItem">Cancelar</button>
          </div>
        </div>
      </td>
    </tr>`;
}

function insertItemEditor() {
  $$('.inline-editor-row').forEach((row) => row.remove());
  const item = editingItemId ? itemCache.find((entry) => Number(entry.id) === Number(editingItemId)) : null;
  const html = editorTemplate(item);
  if (creatingItem) {
    $('#itemsBody').insertAdjacentHTML('afterbegin', html);
  } else {
    const target = $(`.item-row[data-id="${editingItemId}"]`);
    if (target) target.insertAdjacentHTML('afterend', html);
  }
  attachItemEditorEvents(item);
  function updateGoldLabels(){const cursed=$('#itemRarity').value==='Amaldiçoado';$('#goldMinLabel').textContent=cursed?'Perda mín.':'Ouro mín.';$('#goldMaxLabel').textContent=cursed?'Perda máx.':'Ouro máx.';$('#cursedItemHint').textContent=cursed?'Use valores positivos para a perda. O desconto é limitado ao saldo disponível.':'Ganhos de ouro por captura. Imagens PNG/WEBP transparentes são preservadas.';}
  $('#itemRarity').addEventListener('change',updateGoldLabels);updateGoldLabels();
  $('.inline-editor-row')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openItemEditor(id = null) {
  editingItemId = id;
  creatingItem = !id;
  editorImageData = '';
  editorRemoveImage = false;
  insertItemEditor();
  setTimeout(() => $('#itemName')?.focus(), 60);
}

function closeItemEditor() {
  editingItemId = null;
  creatingItem = false;
  editorImageData = '';
  editorRemoveImage = false;
  $('.inline-editor-row')?.remove();
}

async function compressImage(file) {
  if (!file) return '';
  if (file.size > 8 * 1024 * 1024) throw new Error('Escolha uma imagem de até 8 MB.');
  const bitmap = await createImageBitmap(file);
  const max = 160;
  const scale = Math.min(max / bitmap.width, max / bitmap.height, 1);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = max;
  canvas.height = max;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, max, max);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, Math.round((max - width) / 2), Math.round((max - height) / 2), width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  if (!blob) throw new Error('Não foi possível processar a imagem.');
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(blob);
  });
}

function attachItemEditorEvents(item) {
  $('#closeInlineEditor')?.addEventListener('click', closeItemEditor);
  $('#cancelItem')?.addEventListener('click', closeItemEditor);
  $('#itemImageInput')?.addEventListener('change', async (event) => {
    try {
      editorImageData = await compressImage(event.target.files?.[0]);
      editorRemoveImage = false;
      const box = $('.editor-image-preview');
      box.innerHTML = `<img id="editorImagePreview" src="${escapeAttr(editorImageData)}" alt="" />`;
    } catch (error) { showEvent(error.message); }
  });
  $('#removeItemImage')?.addEventListener('click', () => {
    editorImageData = '';
    editorRemoveImage = true;
    $('.editor-image-preview').innerHTML = '<span id="editorImageEmpty">SEM IMAGEM</span>';
  });
  $('#saveItem')?.addEventListener('click', async () => {
    try {
      const payload = {
        name: $('#itemName').value.trim(),
        rarity: $('#itemRarity').value,
        chance: Number($('#itemChance').value),
        goldMin: Number($('#itemGoldMin').value),
        goldMax: Number($('#itemGoldMax').value),
        messageTemplate: $('#itemMessageTemplate').value.trim(),
        imageData: editorImageData || undefined,
        removeImage: editorRemoveImage
      };
      if (!payload.name) throw new Error('Informe o nome do item.');
      if (payload.goldMax < payload.goldMin) throw new Error('O Ouro máximo não pode ser menor que o mínimo.');

      if (editingItemId) {
        await api(`/api/items/${editingItemId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showEvent(`${payload.name} atualizado.`);
      } else {
        await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
        showEvent(`${payload.name} adicionado.`);
      }
      closeItemEditor();
      await loadItems();
      await loadStatus();
    } catch (error) { showEvent(error.message); }
  });
  $('#deleteItem')?.addEventListener('click', async () => {
    if (!item || !confirm(`Excluir "${item.name}"? O histórico antigo será preservado.`)) return;
    try {
      await api(`/api/items/${item.id}`, { method: 'DELETE' });
      showEvent(`${item.name} excluído do catálogo.`);
      closeItemEditor();
      await loadItems();
      await loadStatus();
    } catch (error) { showEvent(error.message); }
  });
}

async function loadPlayers() {
  playersCache = await api('/api/players');
  const rankSelect=$('#rankingOverlayPlayer');const selected=rankSelect.value;
  rankSelect.innerHTML='<option value="">Top 5 geral</option>'+playersCache.map(p=>'<option value="'+escapeAttr(p.twitch_user_id)+'">'+escapeHtml(p.display_name||p.login)+'</option>').join('');rankSelect.value=selected;
  for (const select of [$('#collectionPlayer'), $('#achievementPlayer')]) {
    const previous = select.value;
    select.innerHTML = playersCache.length
      ? playersCache.map((player) => `<option value="${escapeAttr(player.twitch_user_id)}">${escapeHtml(player.display_name || player.login)}</option>`).join('')
      : '<option value="">Nenhum jogador</option>';
    if (playersCache.some((p) => p.twitch_user_id === previous)) select.value = previous;
  }
}

async function loadCollection(userId = $('#collectionPlayer')?.value) {
  if (!userId) {
    $('#collectionGrid').innerHTML = '<div class="empty-state">Ainda não há jogadores com pescarias.</div>';
    $('#collectionCount').textContent = '0 / 0';
    $('#collectionBar').style.width = '0%';
    return;
  }
  const data = await api(`/api/collection?userId=${encodeURIComponent(userId)}`);
  const total = Number(data.summary?.total || 0);
  const discovered = Number(data.summary?.discovered || 0);
  const pct = total ? Math.round((discovered / total) * 100) : 0;
  $('#collectionCount').textContent = `${discovered} / ${total} (${pct}%)`;
  $('#collectionBar').style.width = `${pct}%`;
  $('#collectionGrid').innerHTML = (data.items || []).map((item) => {
    const found = Number(item.quantity || 0) > 0;
    return `<div class="collection-card ${found ? 'found' : 'locked'}">
      <div class="collection-image">${found && item.image_path ? `<img src="${escapeAttr(item.image_path)}" alt="" />` : found ? '🎣' : '?'}</div>
      <div><strong>${found ? escapeHtml(item.name) : '???'}</strong><span class="rarity-pill ${found ? rarityClass(item.rarity) : ''}">${found ? escapeHtml(item.rarity) : 'Não descoberto'}</span></div>
      <b>${found ? `×${formatNumber(item.quantity)}` : ''}</b>
    </div>`;
  }).join('');
}

async function loadAchievements(userId = $('#achievementPlayer')?.value) {
  if (!userId) {
    $('#resetPlayerAchievements').disabled = true;
    $('#achievementsGrid').innerHTML = '<div class="empty-state">Ainda não há jogadores.</div>';
    return;
  }
  $('#resetPlayerAchievements').disabled = false;
  const data = await api(`/api/achievements?userId=${encodeURIComponent(userId)}`);
  $('#achievementsGrid').innerHTML = data.achievements.map((achievement) => `
    <div class="achievement-card ${achievement.unlocked ? 'unlocked' : 'locked'}">
      <div class="achievement-icon">${achievement.unlocked ? FishingVisuals.icon(achievement.metric) : '🔒'}</div>
      <div><strong>${escapeHtml(achievement.name)}</strong><p>${escapeHtml(achievement.description)}</p><p>${achievement.unlocked ? 'Conquistada' : `Progresso: ${formatNumber(achievement.progress)} / ${formatNumber(achievement.target)}`}</p></div>
    </div>
  `).join('');
}

async function loadRanking() {
  const rows = await api('/api/leaderboard');
  if (editingRankUserId) return;
  $('#rankingBody').innerHTML = rows.length ? rows.map((row, i) => `
    <tr class="rank-row" data-user-id="${escapeAttr(row.twitch_user_id)}">
      <td>${i + 1}</td><td><strong>${escapeHtml(row.display_name || row.login)}</strong></td><td>${formatNumber(row.gold)}</td><td>${formatNumber(row.total_catches)}</td>
      <td class="actions-cell"><button class="small edit-rank" data-id="${escapeAttr(row.twitch_user_id)}">Editar</button> <button class="small danger delete-player" data-id="${escapeAttr(row.twitch_user_id)}">Excluir</button> <button class="small danger reset-rank" data-id="${escapeAttr(row.twitch_user_id)}">Resetar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="muted">Nenhuma pescaria registrada.</td></tr>';

  $$('.delete-player').forEach(button=>button.addEventListener('click',async()=>{
    const player=rows.find(p=>p.twitch_user_id===button.dataset.id);
    if(!player||!confirm('Excluir '+(player.display_name||player.login)+' deste canal? Isso remove ranking, coleção, conquistas e histórico desta pessoa. Uma nova pescaria cria um cadastro vazio.'))return;
    try{await api('/api/players/'+encodeURIComponent(player.twitch_user_id),{method:'DELETE'});editingRankUserId=null;await loadPlayers();await refreshPlayerData();showEvent('Jogador excluído deste canal.');}catch(error){showEvent(error.message);}
  }));
  $$('.edit-rank').forEach((button) => button.addEventListener('click', () => openRankEditor(button.dataset.id, rows)));
  $$('.reset-rank').forEach((button) => button.addEventListener('click', async () => {
    const player = rows.find((entry) => entry.twitch_user_id === button.dataset.id);
    if (!player || !confirm(`Resetar apenas Ouro e Pescarias de ${player.display_name || player.login}? A coleção será mantida.`)) return;
    await api(`/api/leaderboard/${encodeURIComponent(player.twitch_user_id)}/reset`, { method: 'POST', body: '{}' });
    showEvent(`Ranking de ${player.display_name || player.login} resetado.`);
    await refreshPlayerData();
  }));
}

function openRankEditor(userId, rows) {
  editingRankUserId = userId;
  $$('.rank-editor-row').forEach((row) => row.remove());
  const player = rows.find((entry) => entry.twitch_user_id === userId);
  const target = $(`.rank-row[data-user-id="${CSS.escape(userId)}"]`);
  if (!player || !target) return;
  target.insertAdjacentHTML('afterend', `
    <tr class="rank-editor-row"><td colspan="5"><div class="rank-editor-inline">
      <strong>Editando ${escapeHtml(player.display_name || player.login)}</strong>
      <label>Ouro <input id="rankGold" type="number" min="0" value="${Number(player.gold)}" /></label>
      <label>Pescarias <input id="rankCatches" type="number" min="0" value="${Number(player.total_catches)}" /></label>
      <button id="saveRank" class="primary small">Salvar</button><button id="cancelRank" class="small">Cancelar</button>
    </div></td></tr>`);
  $('#cancelRank').addEventListener('click', () => { editingRankUserId = null; $('.rank-editor-row')?.remove(); loadRanking(); });
  $('#saveRank').addEventListener('click', async () => {
    await api(`/api/leaderboard/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify({
      gold: Number($('#rankGold').value), totalCatches: Number($('#rankCatches').value),
      baseGold: Number(player.gold), baseCatches: Number(player.total_catches)
    }) });
    editingRankUserId = null;
    showEvent(`Ranking de ${player.display_name || player.login} atualizado. Capturas recebidas durante a edição foram preservadas.`);
    await refreshPlayerData();
  });
}

async function refreshPlayerData() {
  await loadSummary();
  const page=$('.page.active')?.id;
  if(page==='page-ranking') await loadRanking();
  if(page==='page-collection') { await loadPlayers(); await loadCollection(); }
  if(page==='page-achievements') { await loadPlayers(); await loadAchievements(); }
}

async function loadSummary() {
  const summary = await api('/api/summary');
  const data={summary};
  $('#summaryPlayers').textContent = formatNumber(data.summary?.players || 0);
  $('#summaryCatches').textContent = formatNumber(data.summary?.catches || 0);
  $('#summaryItems').textContent = formatNumber(data.summary?.items || 0);
}

function showEvent(message) { $('#eventLog').textContent = message; }

function updateCooldownExample() {
  if (!$('#cooldownTemplate')) return;
  const tpl = $('#cooldownTemplate').value || '';
  $('#cooldownExample').textContent = tpl
    .replaceAll('{user}', 'JumperJJJ')
    .replaceAll('{tempo}', '1 min 40 s')
    .replaceAll('{item}', 'Sardinha')
    .replaceAll('{raridade}', 'Comum')
    .replaceAll('{ouro}', '17')
    .replaceAll('{ouro_total}', '2.350')
    .replaceAll('{pescarias}', '91');
}

function hexToRgba(hex, alpha) {
  const value = String(hex || '#000000').replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.padEnd(6, '0').slice(0, 6);
  const num = parseInt(normalized, 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

function overlayControlValues() {
  return {
    bg: $('#overlayBg').value,
    text: $('#overlayText').value,
    accent: $('#overlayAccent').value,
    gold: $('#overlayGold').value,
    opacity: Number($('#overlayOpacity').value),
    x: Number($('#overlayX').value),
    y: Number($('#overlayY').value),
    scale: Number($('#overlayScale').value),
    imageSize: Number($('#overlayImageSize').value),
    imageScale: Number($('#overlayImageScale').value),
    radius: Number($('#overlayRadius').value),
    animation: $('#overlayAnimation').value,
    layout: $('#overlayLayout').value,
    showImage: $('#overlayShowImage').checked
  };
}

function updateOverlayPreview() {
  if (!$('#previewFishingCard')) return;
  const v = overlayControlValues();
  $('#overlayOpacityValue').textContent = `${v.opacity}%`;
  $('#overlayScaleValue').textContent = `${v.scale}%`;
  $('#overlayImageScaleValue').textContent=`${v.imageScale}%`;
  $('#overlayImageSizeValue').textContent = `${v.imageSize}px`;
  $('#overlayRadiusValue').textContent = `${v.radius}px`;
  const width=Number($('#overlayWidth').value)||640; const height=Number($('#overlayHeight').value)||360;
  $('#overlayDimensions').textContent=`OBS: ${width} × ${height}`;
  $('#overlayPreview').style.aspectRatio=`${width} / ${height}`;
  $('#overlayLivePreview').style.aspectRatio=`${width} / ${height}`;

  const card = $('#previewFishingCard');
  const stage=$('#overlayPreview');
  card.style.transform = `translate(-50%, -50%) scale(${v.scale / 100})`;
  card.style.background = hexToRgba(v.bg, v.opacity / 100);
  card.style.color = v.text;
  card.style.borderColor = `${v.accent}77`;
  card.style.borderRadius = `${v.radius}px`;
  card.dataset.animation = v.animation;
  card.dataset.layout = v.layout;
  $('.preview-rarity').style.color = v.accent;
  $('.preview-gold').style.color = v.gold;

  const img = $('#previewItemImage');
  img.style.width = `${v.imageSize*v.imageScale/100}px`;
  img.style.height = `${v.imageSize*v.imageScale/100}px`;
  const sample = itemCache.find((item) => item.image_path)?.image_path || '';
  if (v.showImage && sample) {
    img.src = sample;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }
  const cardWidth=card.offsetWidth*v.scale/100,cardHeight=card.offsetHeight*v.scale/100;
  const fitX=Math.max(Math.min(stage.clientWidth/2,cardWidth/2+8),Math.min(stage.clientWidth-cardWidth/2-8,stage.clientWidth*v.x/100));
  const fitY=Math.max(Math.min(stage.clientHeight/2,cardHeight/2+8),Math.min(stage.clientHeight-cardHeight/2-8,stage.clientHeight*v.y/100));
  card.style.left = `${fitX}px`;
  card.style.top = `${fitY}px`;
}

$$('.nav').forEach((button) => button.addEventListener('click', async () => {
  $$('.nav').forEach((x) => x.classList.remove('active'));
  $$('.page').forEach((x) => x.classList.remove('active'));
  button.classList.add('active');
  $(`#page-${button.dataset.page}`).classList.add('active');
  if (button.dataset.page === 'items') await loadItems();
  if (button.dataset.page === 'ranking') await loadRanking();
  if (button.dataset.page === 'collection') { await loadPlayers(); await loadCollection(); }
  if (button.dataset.page === 'achievements') { await loadPlayers(); await loadAchievements(); }
  if (button.dataset.page === 'overlay') updateOverlayPreview();
  if (button.dataset.page === 'events') await eventsEditor.load();
  if (button.dataset.page === 'extra-overlays') await extraEditor.load();
}));

$('#newItem').addEventListener('click', () => openItemEditor());
$('#collectionPlayer').addEventListener('change', () => loadCollection());
$('#achievementPlayer').addEventListener('change', () => loadAchievements());
$('#cooldownTemplate').addEventListener('input', updateCooldownExample);

$('#saveCommandSettings').addEventListener('click', async () => {
  const data = await api('/api/settings', { method: 'POST', body: JSON.stringify({
    command: $('#command').value.trim() || '!pescar',
    cooldown_seconds: $('#cooldown').value,
    fishing_seconds: $('#fishingSeconds').value,
    overlay_result_seconds: $('#resultSeconds').value,
    achievement_seconds: $('#achievementSeconds').value,
    chat_pending_template: $('#pendingTemplate').value.trim(),
    chat_result_enabled: $('#chatResultEnabled').checked ? '1' : '0',
    chat_cooldown_enabled: $('#chatCooldownEnabled').checked ? '1' : '0',
    chat_result_template: $('#resultTemplate').value.trim(),
    chat_cursed_template: $('#cursedTemplate').value.trim(),
    chat_cooldown_template: $('#cooldownTemplate').value.trim()
  }) });
  settings = data.settings;
  $('#quickCommand').textContent = settings.command;
  $('#quickCooldown').textContent = `${settings.cooldown_seconds}s`;
  showEvent('Comando, tempos e mensagens salvos.');
});
$('#saveCommandSettingsBottom').addEventListener('click', () => $('#saveCommandSettings').click());

$('#testFish').addEventListener('click', async () => {
  $('#testFish').disabled = true;
  showEvent('Pescador Teste está pescando…');
  try {
    const result = await api('/api/test-fish', { method: 'POST', body: '{}' });
    if (result.ok) showEvent(`${result.user.displayName} pescou ${result.item.name} (${result.item.rarity}) e ${result.item.isCursed?'perdeu':'ganhou'} ${Math.abs(result.item.goldAwarded)} de Ouro.`);
    else showEvent(result.pending ? 'O teste anterior ainda está na fila ou em exibição. Aguarde.' : 'Não foi possível pescar: ' + result.reason);
    await refreshPlayerData();
  } catch (error) { showEvent(error.message); }
  finally { $('#testFish').disabled = false; }
});

$('#copyOverlay').addEventListener('click', async () => {
  const url = await window.desktop.copyOverlayUrl();
  showEvent(`URL copiada: ${url}`);
});
$('#openOverlay').addEventListener('click', () => window.desktop.openExternal($('#overlayUrl').textContent));

const overlayInputs = ['#overlayBg','#overlayText','#overlayAccent','#overlayGold','#overlayOpacity','#overlayScale','#overlayImageSize','#overlayImageScale','#overlayRadius','#overlayAnimation','#overlayShowImage','#overlayLayout','#overlayWidth','#overlayHeight'];
overlayInputs.forEach((selector) => $(selector).addEventListener('input', updateOverlayPreview));

$('#resetOverlay').addEventListener('click', () => {
  $('#overlayBg').value = '#07131d'; $('#overlayText').value = '#ffffff'; $('#overlayAccent').value = '#70e0c5'; $('#overlayGold').value = '#ffd45f';
  $('#overlayOpacity').value = 90; $('#overlayX').value = 50; $('#overlayY').value = 86; $('#overlayScale').value = 100; $('#overlayImageSize').value = 72; $('#overlayImageScale').value=100; $('#overlayRadius').value = 16; $('#overlayAnimation').value = 'pop'; $('#overlayShowImage').checked = true;
  updateOverlayPreview();
});

$('#saveOverlaySettings').addEventListener('click', async () => {
  const v = overlayControlValues();
  const data = await api('/api/settings', { method: 'POST', body: JSON.stringify({
    overlay_enabled: $('#overlayEnabled').checked ? '1' : '0',
    achievement_overlay_enabled: $('#achievementOverlayEnabled').checked ? '1' : '0',
    overlay_sound_enabled: $('#overlaySound').checked ? '1' : '0',
    overlay_show_image: v.showImage ? '1' : '0',
    overlay_bg_color: v.bg,
    overlay_text_color: v.text,
    overlay_accent_color: v.accent,
    overlay_gold_color: v.gold,
    overlay_opacity: String(v.opacity),
    overlay_x: String(v.x),
    overlay_y: String(v.y),
    overlay_scale: String(v.scale),
    overlay_image_size: String(v.imageSize), overlay_image_scale: String(v.imageScale),
    overlay_radius: String(v.radius),
    overlay_animation: v.animation,
    overlay_layout: v.layout,
    overlay_width: $('#overlayWidth').value,
    overlay_height: $('#overlayHeight').value
  }) });
  settings = data.settings;
  showEvent('Overlay salvo.');
});

$('#connectTwitch').addEventListener('click', async () => {
  $('#connectTwitch').disabled = true;
  try {
    const clientId = $('#clientId').value.trim();
    const targetChannelLogin = $('#targetChannel').value.trim().replace(/^@/, '');
    const expectedBotLogin = $('#expectedBotLogin').value.trim().replace(/^@/, '').toLowerCase();
    if (!clientId) throw new Error('Informe o Client ID da aplicação Twitch.');
    if (!targetChannelLogin) throw new Error('Informe o canal da live.');
    if (!expectedBotLogin) throw new Error('Informe a conta do bot esperada.');

    await api('/api/settings', { method: 'POST', body: JSON.stringify({ twitch_client_id: clientId, target_channel_login: targetChannelLogin, expected_bot_login: expectedBotLogin }) });
    const device = await api('/api/twitch/device', { method: 'POST', body: JSON.stringify({ clientId }) });
    $('#deviceBox').classList.remove('hidden');
    $('#deviceCode').textContent = device.user_code;
    $('#openTwitchAuth').onclick = () => window.desktop.openExternal(device.verification_uri);
    $('#deviceProgress').textContent = `Autorize a conta ${expectedBotLogin}. Aguardando…`;
    window.desktop.openExternal(device.verification_uri);
    const result = await window.desktop.completeTwitchDeviceAuth({
      clientId, deviceCode: device.device_code, interval: device.interval, expiresIn: device.expires_in, targetChannelLogin
    });
    $('#deviceProgress').textContent = 'Autorizado! Chat pronto para receber o primeiro comando.';
    setBotConnected(true);
    $('#twitchStatus').className = 'status online';
    $('#twitchStatus').textContent = `● Bot ${result.identity.bot.display_name} → ${result.identity.channel.display_name}`;
    showEvent(`Conectado: ${result.identity.bot.display_name} está ouvindo ${result.identity.channel.display_name}.`);
  } catch (error) {
    $('#deviceProgress').textContent = error.message;
    showEvent(error.message);
  }
  finally { if(!botConnected) $('#connectTwitch').disabled = false; }
});

const ws = new WebSocket(`ws://${location.host}/ws`);
ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'fishing:start') showEvent(`${data.user.displayName} está pescando…`);
  if (data.type === 'fishing:result' && !data.preview) {
    showEvent(`${data.user.displayName} pescou ${data.item.name} (${data.item.rarity}) • ${data.item.goldAwarded<0?'−':'+'}${Math.abs(data.item.goldAwarded)} Ouro • total ${data.player.gold}`);
    refreshPlayerData();
  }
  if(data.type==='event:updated'&&$('.page.active')?.id==='page-events')eventsEditor.load(false).catch(error=>showEvent(error.message));
  if(data.type==='event:error')showEvent(data.message);
  if (data.type === 'bot:sent') showEvent(`Bot enviou: ${data.message}`);
  if (data.type === 'achievement:unlocked' && !data.preview) { showEvent(`${data.user.displayName} conquistou ${data.achievement.name}!`); if($('.page.active')?.id==='page-achievements') loadAchievements(); }
  if (data.type === 'fishing:cooldown') showEvent(`${data.user.displayName}: aguarde ${data.remainingSeconds}s.`);
  if (data.type === 'fishing:error') showEvent(data.message);
  if (data.type === 'twitch:error') showEvent(data.message);
  if (data.type === 'twitch:connected') {
    setBotConnected(true);
    $('#twitchStatus').className = 'status online';
    $('#twitchStatus').textContent = `● Bot ${data.identity.bot.display_name} → ${data.identity.channel.display_name}`;
  }
  if (data.type === 'twitch:disconnected') {
    setBotConnected(false);
    $('#twitchStatus').className = 'status';
    $('#twitchStatus').textContent = '● Bot desconectado';
  }
  if (data.type === 'settings:updated' && !data.previewSettings) settings = data.settings || settings;
});

Promise.all([loadStatus(), loadItems(), loadPlayers(), loadRanking()]).then(async () => {
  await loadCollection();
  await loadAchievements();
  updateOverlayPreview();
}).catch((error) => showEvent(error.message));

let achievementDefinitions = [];
async function loadAchievementDefinitions() {
  achievementDefinitions = await api('/api/achievement-definitions');
  $('#achievementDefinition').innerHTML = '<option value="">Nova conquista</option>' + achievementDefinitions.map(def =>
    '<option value="' + def.id + '">' + escapeHtml(def.name) + (def.enabled ? '' : ' (desativada)') + '</option>').join('');
}
$('#achievementDefinition').addEventListener('change', () => {
  const def = achievementDefinitions.find(def => String(def.id) === $('#achievementDefinition').value);
  $('#achievementName').value = def?.name || '';
  $('#achievementDescription').value = def?.description || '';
  $('#achievementMetric').value = def?.metric || 'catches';
  $('#achievementTarget').value = def?.target ?? 1;
  $('#achievementEnabled').checked = !def || Boolean(def.enabled);
  updateAchievementParameter(def?.parameter || '');
});
$('#saveAchievement').addEventListener('click', async () => {
  try {
    const id = $('#achievementDefinition').value;
    await api('/api/achievement-definitions' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify({
      name: $('#achievementName').value, description: $('#achievementDescription').value,
      metric: $('#achievementMetric').value, parameter: $('#achievementParameter').value, target: $('#achievementTarget').value, enabled: $('#achievementEnabled').checked
    }) });
    await loadAchievementDefinitions(); await loadAchievements();
    showEvent('Conquista salva.');
  } catch (error) { showEvent(error.message); }
});
$('#testCooldown').addEventListener('click', async () => {
  try { await api('/api/test-cooldown', { method: 'POST', body: '{}' }); showEvent('Mensagem de teste enviada pelo bot.'); }
  catch (error) { showEvent(error.message); }
});
loadAchievementDefinitions().catch(error => showEvent(error.message));
window.addEventListener('unhandledrejection', event => { showEvent(event.reason?.message || 'Não foi possível salvar.'); });

function updateAchievementParameter(value = '') {
  const metric = $('#achievementMetric').value;
  const input = $('#achievementParameter');
  $('#achievementParameterRow').classList.toggle('hidden', !['item_count','rarity_count','rarity_streak'].includes(metric));
  const options = metric === 'item_count' ? itemCache.map(item => [String(item.id), item.name]) :
    ['Lixo','Comum','Raro','Épico','Lendário','Mítico','Amaldiçoado'].map(rarity => [rarity, rarity]);
  if (value && !options.some(option => option[0] === value)) options.push([value, 'Item anterior (' + value + ')']);
  input.innerHTML = options.map(([id, name]) => '<option value="' + escapeAttr(id) + '">' + escapeHtml(name) + '</option>').join('');
  if (value) input.value = value;
  $('#achievementTarget').max = metric === 'collection' ? '100' : '';
}
$('#achievementMetric').addEventListener('change', () => updateAchievementParameter());
$('#resetPlayerAchievements').addEventListener('click', async () => {
  const select = $('#achievementPlayer');
  if (!select.value || !confirm('Resetar conquistas de ' + select.selectedOptions[0].textContent + '? O progresso das conquistas recomeça agora. Ranking e coleção ficam mantidos.')) return;
  try { await api('/api/achievements/' + encodeURIComponent(select.value) + '/reset', { method: 'POST', body: '{}' });
    await loadAchievements(); showEvent('Conquistas resetadas para este jogador. O novo progresso começa agora.');
  } catch (error) { showEvent(error.message); }
});
const achievementIdeas = [
  ['Achado curioso','Pesque seu primeiro item de lixo.','rarity_count','Lixo',1],
  ['Primeiro peixe comum','Pesque um peixe comum.','rarity_count','Comum',1],
  ['Primeiro raro','Pesque seu primeiro raro.','rarity_count','Raro',1],
  ['Primeiro épico','Pesque seu primeiro épico.','rarity_count','Épico',1],
  ['Primeira lenda','Pesque seu primeiro lendário.','rarity_count','Lendário',1],
  ['Primeiro mito','Pesque seu primeiro mítico.','rarity_count','Mítico',1],
  ['Primeiro susto','Pesque um item amaldiçoado.','rarity_count','Amaldiçoado',1],
  ['Azar persistente','Pesque 3 amaldiçoados.','rarity_count','Amaldiçoado',3],
  ['Tributo ao lago','Perca 5.000 de ouro com capturas amaldiçoadas.','lost_gold','',5000],
  ['Maré comum','Pesque 10 comuns consecutivos.','rarity_streak','Comum',10],
  ['Pescador de fim de semana','Pesque em 2 dias diferentes.','fishing_days','',2],
  ['Limpando o lago', 'Pesque 10 itens de lixo.', 'rarity_count', 'Lixo', 10],
  ['Caçador de lendas', 'Pesque 3 itens lendários.', 'rarity_count', 'Lendário', 3],
  ['Maré épica', 'Pesque 2 épicos consecutivos.', 'rarity_streak', 'Épico', 2],
  ['Grande prêmio', 'Ganhe 1.000 de ouro em uma captura.', 'biggest_gold', '', 1000],
  ['Volta ao lago', 'Pesque em 7 dias diferentes.', 'fishing_days', '', 7],
  ['Dia de pescador', 'Faça 20 pescarias no mesmo dia.', 'daily_catches', '', 20],
  ['Tesouro do dia', 'Ganhe 5.000 de ouro em um dia.', 'daily_gold', '', 5000],
  ['Todas as cores', 'Pesque itens de 6 raridades diferentes.', 'rarity_variety', '', 6],
  ['Bolso cheio', 'Ganhe 25.000 de ouro nas pescarias.', 'total_gold', '', 25000],
  ['Explorador', 'Descubra 5 itens da coleção.', 'unique_items', '', 5],
  ['Saco de botas', 'Pesque 25 itens de lixo.', 'rarity_count', 'Lixo', 25],
  ['Maré mítica', 'Pesque seu primeiro item mítico.', 'rarity_count', 'Mítico', 1],
  ['Pescador de raridades', 'Pesque 15 itens raros.', 'rarity_count', 'Raro', 15],
  ['Rede dourada', 'Pesque 10 lendários.', 'rarity_count', 'Lendário', 10],
  ['Paciência de pescador', 'Complete 500 pescarias.', 'catches', '', 500],
  ['O lago é minha casa', 'Pesque em 30 dias diferentes.', 'fishing_days', '', 30],
  ['Mutirão no lago', 'Faça 50 pescarias no mesmo dia.', 'daily_catches', '', 50],
  ['Fisgada milionária', 'Ganhe 50.000 ouro numa única captura.', 'biggest_gold', '', 50000],
  ['Meio bestiário', 'Descubra metade da coleção.', 'collection', '', 50],
  ['Três fisgadas verdes', 'Pesque 3 comuns consecutivos.', 'rarity_streak', 'Comum', 3],
  ['Lago limpo', 'Pesque 5 lixos consecutivos.', 'rarity_streak', 'Lixo', 5],
  ['Coleção de respeito', 'Descubra 10 itens diferentes.', 'unique_items', '', 10]
];
$('#achievementIdea').innerHTML = '<option value="">Escolha uma ideia para preencher</option>' + achievementIdeas.map((idea, index) => '<option value="' + index + '">' + escapeHtml(idea[0]) + '</option>').join('');
$('#achievementIdea').addEventListener('change', () => {
  if ($('#achievementIdea').value === '') return;
  const [name, description, metric, parameter, target] = achievementIdeas[Number($('#achievementIdea').value)];
  $('#achievementDefinition').value = ''; $('#achievementName').value = name; $('#achievementDescription').value = description;
  $('#achievementMetric').value = metric; $('#achievementTarget').value = target; $('#achievementEnabled').checked = true;
  updateAchievementParameter(parameter);
});
// Arraste o card ou clique na prévia para definir a posição sem sliders.
const stage = $('#overlayPreview');
let draggingOverlay = false;
function positionOverlay(event) {
  const rect = stage.getBoundingClientRect();
  $('#overlayX').value = Math.round(Math.max(5, Math.min(95, (event.clientX - rect.left) / rect.width * 100)));
  $('#overlayY').value = Math.round(Math.max(5, Math.min(95, (event.clientY - rect.top) / rect.height * 100)));
  updateOverlayPreview();
}
stage.addEventListener('pointerdown', event => { draggingOverlay = true; stage.setPointerCapture(event.pointerId); positionOverlay(event); });
let positionFrame=0;
stage.addEventListener('pointermove', event => { if(draggingOverlay){const point={clientX:event.clientX,clientY:event.clientY};cancelAnimationFrame(positionFrame);positionFrame=requestAnimationFrame(()=>positionOverlay(point));} });
stage.addEventListener('pointerup', () => { draggingOverlay = false; });
stage.addEventListener('pointercancel', () => { draggingOverlay = false; });
$('#testOverlay').addEventListener('click', async () => {
  const button = $('#testOverlay'); button.disabled = true;
  const v = overlayControlValues();
  try {
    $('#overlayLivePreview').classList.remove('hidden');
    await new Promise(resolve => { const frame = $('#overlayLivePreview');
      if (frame.dataset.ready === '1') resolve();
      else { frame.onload = () => { frame.dataset.ready = '1'; resolve(); }; frame.src = '/overlay.html?preview=1'; }
    });
    showEvent('Teste do overlay na fila. Não altera ranking ou coleção.');
    await api('/api/overlay/test', { method: 'POST', body: JSON.stringify({ settings: {
      overlay_bg_color: v.bg, overlay_text_color: v.text, overlay_accent_color: v.accent, overlay_gold_color: v.gold,
      overlay_opacity: String(v.opacity), overlay_x: String(v.x), overlay_y: String(v.y), overlay_scale: String(v.scale),
      overlay_image_size: String(v.imageSize), overlay_image_scale:String(v.imageScale), overlay_radius: String(v.radius), overlay_animation: v.animation,
      overlay_layout: v.layout, overlay_show_image: v.showImage ? '1' : '0'
    } }) });
    showEvent('Teste do overlay concluído. Clique em Salvar overlay para aplicar suas edições.');
  } catch (error) { showEvent(error.message); }
  finally { button.disabled = false; $('#overlayLivePreview').classList.add('hidden'); }
});

let botConnected=false;
function setBotConnected(connected){botConnected=connected;const button=$('#connectTwitch');button.disabled=connected;button.textContent=connected?'✓ Conectado':'Conectar conta do bot';}
async function showPanel(kind,button,userId='') {
  button.disabled=true;
  try{showEvent('Painel na fila de exibição.');await api('/api/overlay/panel',{method:'POST',body:JSON.stringify({kind,userId})});showEvent('Painel exibido.');}
  catch(error){showEvent(error.message);}finally{button.disabled=false;}
}
$('#showRankingOverlay').addEventListener('click',()=>showPanel('ranking',$('#showRankingOverlay'),$('#rankingOverlayPlayer').value));
$('#showCollectionOverlay').addEventListener('click',()=>showPanel('collection',$('#showCollectionOverlay'),$('#collectionPlayer').value));
$('#showAchievementsOverlay').addEventListener('click',()=>showPanel('achievements',$('#showAchievementsOverlay'),$('#achievementPlayer').value));
