/* 展签审校工作台前端（原生 JS） */
const ROLE_NAME = { librarian: '馆员', translator: '译者', reviewer: '校对' };

const state = {
  me: null,
  languages: [],
  currentLangId: null,
  board: null,
};

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 3200);
}

async function api(path, opts = {}) {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (resp.status === 401) {
    location.href = '/login';
    throw new Error('未登录');
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // 409 发布失败时 detail 为 {message, reasons}
    const d = data.detail;
    if (d && typeof d === 'object') {
      throw new Error(d.message + (d.reasons && d.reasons.length ? '：' + d.reasons.join('；') : ''));
    }
    throw new Error(typeof d === 'string' ? d : '请求失败 (' + resp.status + ')');
  }
  return data;
}

const isWorker = () => state.me.role === 'translator' || state.me.role === 'reviewer';
const isLibrarian = () => state.me.role === 'librarian';

// ---------------------------- 初始化 ----------------------------

async function init() {
  state.me = await api('/api/me');
  $('#who').textContent = `${state.me.display_name}（${state.me.username}）`;
  const rb = $('#role-badge');
  rb.textContent = ROLE_NAME[state.me.role];
  rb.classList.add(state.me.role);

  $('#logout-btn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login';
  });

  if (isLibrarian()) {
    $('#librarian-panel').hidden = false;
    bindLibrarianEvents();
  }

  await loadLanguages();
  await loadSnapshots();
}

async function loadLanguages() {
  state.languages = await api('/api/languages');
  const tabs = $('#lang-tabs');
  if (!state.languages.length) {
    tabs.innerHTML = '<span class="muted">尚无目标语言，请馆员先添加。</span>';
    $('#board').innerHTML = '';
    return;
  }
  if (!state.languages.some((l) => l.id === state.currentLangId)) {
    state.currentLangId = state.languages[0].id;
  }
  tabs.innerHTML = state.languages.map((l) => `
    <button class="langtab ${l.id === state.currentLangId ? 'active' : ''}" data-id="${l.id}">
      ${esc(l.name)} <span class="muted">${esc(l.code)}</span>
    </button>`).join('');
  tabs.querySelectorAll('.langtab').forEach((b) =>
    b.addEventListener('click', () => {
      state.currentLangId = Number(b.dataset.id);
      loadLanguages().then(loadBoard);
    }));
  await loadBoard();
  if (isLibrarian()) loadLabelAdmin();
}

// ---------------------------- 馆员：原文与语言 ----------------------------

async function loadLabelAdmin() {
  const labels = await api('/api/labels');
  const onShow = labels.filter((l) => l.display_status !== 'withdrawn');
  const withdrawn = labels.filter((l) => l.display_status === 'withdrawn');

  const renderOnShow = (l) => `
    <div class="item" data-label="${l.id}">
      <div class="meta">#${l.id} · 原文修订号 ${l.source_rev} · 更新于 ${esc(l.updated_at)}
        <span class="tag ready">在展</span>
      </div>
      <textarea class="src-edit" rows="2">${esc(l.source_text)}</textarea>
      <div class="row-actions">
        <button class="small ghost save-src" data-id="${l.id}" data-rev="${l.source_rev}">
          保存原文（修订号升至 ${l.source_rev + 1}，并使该条所有译文确认失效）
        </button>
        <button class="small danger toggle-withdraw" data-id="${l.id}" data-sv="${l.status_version}">
          撤展
        </button>
      </div>
      <div class="withdraw-form" hidden data-label="${l.id}">
        <label>撤展原因（必填，工作台与审计记录保留）</label>
        <textarea class="withdraw-reason" rows="2" placeholder="例如：文物外借、展签内容待核…"></textarea>
        <div class="row-actions">
          <button class="small danger do-withdraw" data-id="${l.id}" data-sv="${l.status_version}">
            确认撤展
          </button>
          <button class="small ghost cancel-withdraw">取消</button>
        </div>
      </div>
    </div>`;

  const renderWithdrawn = (l) => `
    <div class="item withdrawn-item" data-label="${l.id}">
      <div class="meta">#${l.id} · 原文修订号 ${l.source_rev}
        <span class="tag withdrawn">已撤展</span>
      </div>
      <div class="src">${esc(l.source_text)}</div>
      <div class="reason-block">
        撤展原因：${esc(l.withdrawn_reason || '—')}<br>
        撤展：${esc(l.withdrawn_by_name || ('#' + l.withdrawn_by))} · ${esc(l.withdrawn_at)}
        ${l.restored_at ? `（曾复展于 ${esc(l.restored_at)}）` : ''}
      </div>
      <div class="muted" style="margin:6px 0">
        撤展后已从所有语言游客最新内容隐藏；译文保留，复展后须经他人重新确认并发新快照。
      </div>
      <div class="row-actions">
        <button class="small do-restore" data-id="${l.id}" data-sv="${l.status_version}">
          复展（状态版本升至 ${l.status_version + 1}，清除各语言确认）
        </button>
        <button class="small ghost view-events" data-id="${l.id}">撤展/复展记录</button>
      </div>
    </div>`;

  $('#label-admin').innerHTML = `
    <div class="section-title" style="margin-top:0"><h2 style="font-size:14px">在展展签</h2></div>
    ${onShow.map(renderOnShow).join('') || '<div class="muted">暂无在展展签。</div>'}
    <div class="section-title"><h2 style="font-size:14px">已撤展展签（${withdrawn.length}）</h2></div>
    ${withdrawn.map(renderWithdrawn).join('') || '<div class="muted">无。</div>'}`;

  document.querySelectorAll('.save-src').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const text = document.querySelector(`.item[data-label="${id}"] .src-edit`).value.trim();
      if (!text) return toast('原文不能为空', true);
      btn.disabled = true;
      try {
        await api('/api/labels/' + id, {
          method: 'PUT',
          body: JSON.stringify({ source_text: text, source_rev: Number(btn.dataset.rev) }),
        });
        toast('原文已更新：修订号 +1，相关译文确认已失效');
        await Promise.all([loadLabelAdmin(), loadBoard()]);
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
      }
    }));

  // 展开撤展原因表单
  document.querySelectorAll('.toggle-withdraw').forEach((btn) =>
    btn.addEventListener('click', () => {
      btn.closest('.item').querySelector('.withdraw-form').hidden = false;
      btn.disabled = true;
    }));
  document.querySelectorAll('.cancel-withdraw').forEach((btn) =>
    btn.addEventListener('click', () => {
      const form = btn.closest('.withdraw-form');
      form.hidden = true;
      form.querySelector('.withdraw-reason').value = '';
      const item = btn.closest('.item');
      const t = item.querySelector('.toggle-withdraw');
      if (t) t.disabled = false;
    }));

  // 确认撤展
  document.querySelectorAll('.do-withdraw').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const reason = btn.closest('.withdraw-form').querySelector('.withdraw-reason').value.trim();
      if (!reason) return toast('撤展原因必填', true);
      btn.disabled = true;
      try {
        await api(`/api/labels/${id}/withdraw`, {
          method: 'POST',
          body: JSON.stringify({ status_version: Number(btn.dataset.sv), reason }),
        });
        toast('已撤展：游客最新内容立即隐藏，看板待办与发布不再计入该展签');
        await Promise.all([loadLabelAdmin(), loadBoard()]);
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
      }
    }));

  // 复展
  document.querySelectorAll('.do-restore').forEach((btn) =>
    btn.addEventListener('click', () => restoreLabel(btn.dataset.id, Number(btn.dataset.sv), btn)));

  // 撤展/复展记录
  document.querySelectorAll('.view-events').forEach((btn) =>
    btn.addEventListener('click', () => viewStatusEvents(btn.dataset.id)));
}

async function restoreLabel(id, statusVersion, btn) {
  if (btn) btn.disabled = true;
  try {
    await api(`/api/labels/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ status_version: statusVersion }),
    });
    toast('已复展：译文保留但各语言确认已清除，须经他人重新确认并发布新快照后游客才可见');
    await Promise.all([loadLabelAdmin(), loadBoard()]);
  } catch (e) {
    toast(e.message, true);
    if (btn) btn.disabled = false;
  }
}

async function viewStatusEvents(id) {
  const events = await api(`/api/labels/${id}/status-events`);
  $('#snap-title').textContent = `展签 #${id} 撤展 / 复展记录`;
  $('#snap-body').innerHTML = events.length
    ? events.map((e) => `
      <div class="visitor-entry">
        <div class="meta">${esc(e.created_at)} · 状态版本 ${e.status_version}</div>
        <div>
          <span class="tag ${e.action === 'withdraw' ? 'withdrawn' : 'ready'}">
            ${e.action === 'withdraw' ? '撤展' : '复展'}
          </span>
          <b style="margin-left:8px">${esc(e.operator_name)}（${esc(e.operator_username)}）</b>
        </div>
        ${e.reason ? `<div class="t" style="margin-top:4px">原因：${esc(e.reason)}</div>` : ''}
      </div>`).join('')
    : '<div class="muted">暂无记录。</div>';
  $('#snapshot-modal').hidden = false;
}

function bindLibrarianEvents() {
  $('#add-label-btn').addEventListener('click', async () => {
    const text = $('#new-label-text').value.trim();
    if (!text) return toast('原文不能为空', true);
    try {
      await api('/api/labels', { method: 'POST', body: JSON.stringify({ source_text: text, source_rev: 1 }) });
      $('#new-label-text').value = '';
      toast('展签已新增（原文修订号 1）');
      await Promise.all([loadLabelAdmin(), loadBoard()]);
    } catch (e) { toast(e.message, true); }
  });

  $('#add-lang-btn').addEventListener('click', async () => {
    const code = $('#new-lang-code').value.trim();
    const name = $('#new-lang-name').value.trim();
    if (!code || !name) return toast('代码与名称均必填', true);
    try {
      await api('/api/languages', { method: 'POST', body: JSON.stringify({ code, name }) });
      $('#new-lang-code').value = '';
      $('#new-lang-name').value = '';
      toast('语言已新增');
      await loadLanguages();
    } catch (e) { toast(e.message, true); }
  });
}

// ---------------------------- 语言看板 ----------------------------

async function loadBoard() {
  if (!state.currentLangId) return;
  state.board = await api('/api/board/' + state.currentLangId);
  renderBoard();
}

function renderBoard() {
  const b = state.board;
  const c = b.counts;
  const lang = b.language;

  const statusLine = b.latest_snapshot
    ? `最新已发布快照 v${b.latest_snapshot.version}（${esc(b.latest_snapshot.published_at)} 由 ${esc(b.latest_snapshot.published_by_name || '?')} 发布）`
    : '该语言尚未发布过快照';

  let publishHtml;
  if (isLibrarian()) {
    if (b.publishable) {
      publishHtml = `
        <div class="publish-box ok">
          ✅ 全部 ${b.total} 条译文均对应当前原文修订且已确认，可以发布。
          <div class="row-actions">
            <button id="publish-btn">发布新的不可变语言快照</button>
          </div>
        </div>`;
    } else {
      publishHtml = `
        <div class="publish-box blocked">
          🚫 暂不可发布，原因：
          <ul>${b.blocking_reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        </div>`;
    }
  } else {
    publishHtml = `<div class="muted">${b.publishable ? '全部译文已就绪，等待馆员发布。' : '尚有译文未就绪。'}</div>`;
  }

  let html = `
  <div class="card">
    <h2>${esc(lang.name)} <span class="muted">${esc(lang.code)}</span> 审校看板</h2>
    <div class="stats">
      <div class="stat s-missing"><b>${c.missing}</b>待译</div>
      <div class="stat s-pending"><b>${c.pending}</b>待审</div>
      <div class="stat s-stale"><b>${c.stale}</b>过期</div>
      <div class="stat s-ready"><b>${c.ready}</b>已确认</div>
      <div class="stat"><b>${b.total}</b>在展</div>
      <div class="stat s-withdrawn"><b>${b.withdrawn_count}</b>已撤展</div>
    </div>
    <div class="snap-meta" style="margin-top:8px">${statusLine}</div>
    ${publishHtml}
  </div>`;

  html += '<div class="card">' + b.items.map(renderItem).join('') + '</div>';

  // 已撤展展签（不计入待办与发布条件；只读，馆员可在此复展）
  html += `
  <div class="card">
    <h2>已撤展展签（${b.withdrawn_count}）
      <span class="muted" style="font-weight:400">不计入待办/发布，游客最新内容不可见</span>
    </h2>
    ${(b.withdrawn_items || []).map(renderWithdrawnBoardItem).join('')
      || '<div class="muted">该语言暂无已撤展展签。</div>'}
  </div>`;

  $('#board').innerHTML = html;

  const pb = $('#publish-btn');
  if (pb) pb.addEventListener('click', publishSnapshot);
  document.querySelectorAll('.board-restore').forEach((btn) =>
    btn.addEventListener('click', () => restoreLabel(btn.dataset.id, Number(btn.dataset.sv), btn)));
  bindItemEvents();
}

function renderWithdrawnBoardItem(w) {
  const l = w.label;
  const t = w.translation;
  return `
  <div class="item withdrawn-item" data-label="${l.id}">
    <div class="meta">
      展签 #${l.id} · 原文修订号 ${l.source_rev}
      <span class="tag withdrawn">已撤展</span>
    </div>
    <div class="src">${esc(l.source_text)}</div>
    <div class="reason-block">
      撤展原因：${esc(w.reason_text || '—')}<br>
      撤展：${esc(w.withdrawn_by_name || ('#' + l.withdrawn_by))} · ${esc(w.withdrawn_at)}
    </div>
    ${t ? `<div class="muted" style="margin-top:4px">
      译文保留（修订号 ${t.trans_rev}）；复展后确认已清除，须他人重新确认。</div>`
      : '<div class="muted" style="margin-top:4px">该语言尚无译文。</div>'}
    ${isLibrarian() ? `
    <div class="row-actions">
      <button class="small board-restore" data-id="${l.id}" data-sv="${l.status_version}">
        复展
      </button>
    </div>` : ''}
  </div>`;
}

function renderItem(item) {
  const l = item.label;
  const t = item.translation;
  const tagMap = {
    missing: ['待译', 'missing'],
    pending: ['待审', 'pending'],
    stale: ['过期', 'stale'],
    ready: ['已确认', 'ready'],
  };
  const [tagText, tagCls] = tagMap[item.status];

  let transHtml = '';
  if (t) {
    const conf = t.confirmed
      ? `✅ 已由 <b>${esc(t.confirmer_name || ('#' + t.confirmer_id))}</b> 确认`
      : '⏳ 未确认';
    transHtml = `
      <div class="trans">
        <div class="meta">
          译文修订号 ${t.trans_rev} · 对应原文修订号 ${t.source_rev_at_edit} ·
          译者 ${esc(t.translator_name || ('#' + t.translator_id))} · ${conf}
        </div>
        <div class="text">${esc(t.text)}</div>
      </div>`;
  }

  // 操作区
  let actions = '';
  if (isWorker()) {
    const canEdit = true; // 译者/校对均可提交译文
    const own = t && t.translator_id === state.me.id;
    actions += `
      <label>${t ? '修订译文（提交后译文修订号 +1、清除确认）' : '提交译文'}</label>
      <textarea class="t-edit" rows="2">${t ? esc(t.text) : ''}</textarea>
      <div class="row-actions">
        <button class="small submit-trans">${t ? '提交修订' : '提交译文'}</button>`;

    if (t) {
      if (item.status === 'ready') {
        actions += `<span class="muted">已确认，无需操作。</span>`;
      } else if (item.status === 'stale') {
        actions += `<span class="reason">译文基于旧版原文，须先提交修订后再确认。</span>`;
      } else if (own) {
        actions += `<span class="muted">此译文由你提交，依规则须由另一名账号校对确认。</span>`;
      } else {
        actions += `<button class="small ghost confirm-trans">确认译文</button>`;
      }
    }
    actions += '</div>';
  } else if (t && t.confirmed) {
    actions += `<div class="reason ok">✅ 已确认（读者视角为可发布内容）</div>`;
  }

  return `
  <div class="item" data-label="${l.id}"
       data-source-rev="${l.source_rev}"
       data-trans-rev="${t ? t.trans_rev : ''}">
    <div class="meta">
      展签 #${l.id} · 原文修订号 ${l.source_rev}
      <span class="tag ${tagCls}">${tagText}</span>
    </div>
    <div class="src">${esc(l.source_text)}</div>
    ${transHtml}
    <div class="reason ${item.status === 'ready' ? 'ok' : ''}">${esc(item.reason)}</div>
    ${actions}
  </div>`;
}

function bindItemEvents() {
  document.querySelectorAll('.submit-trans').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const box = btn.closest('.item');
      const text = box.querySelector('.t-edit').value.trim();
      if (!text) return toast('译文不能为空', true);
      const payload = {
        text,
        source_rev: Number(box.dataset.sourceRev),
      };
      if (box.dataset.transRev !== '') payload.trans_rev = Number(box.dataset.transRev);
      btn.disabled = true;
      try {
        await api(`/api/board/${state.currentLangId}/labels/${box.dataset.label}/translation`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast('译文已保存：' + (payload.trans_rev ? '译文修订号 +1，确认已清除' : '已提交，等待校对'));
        await loadBoard();
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
      }
    }));

  document.querySelectorAll('.confirm-trans').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const box = btn.closest('.item');
      btn.disabled = true;
      try {
        await api(`/api/board/${state.currentLangId}/labels/${box.dataset.label}/confirm`, {
          method: 'POST',
          body: JSON.stringify({
            source_rev: Number(box.dataset.sourceRev),
            trans_rev: Number(box.dataset.transRev),
          }),
        });
        toast('已确认');
        await loadBoard();
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
      }
    }));
}

// ---------------------------- 发布快照 ----------------------------

async function publishSnapshot() {
  try {
    const r = await api(`/api/board/${state.currentLangId}/publish`, { method: 'POST' });
    toast(`快照 v${r.version} 已发布，内容不可变`);
    await Promise.all([loadBoard(), loadSnapshots()]);
  } catch (e) { toast(e.message, true); }
}

async function loadSnapshots() {
  const snaps = await api('/api/snapshots');
  const el = $('#snapshot-list');
  if (!snaps.length) {
    el.innerHTML = '<span class="muted">尚无已发布快照。</span>';
    return;
  }
  el.classList.remove('muted');
  el.innerHTML = snaps.map((s) => `
    <div class="item" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="tag ready">v${s.version}</span>
      <b>${esc(s.name)}</b> <span class="muted">${esc(s.code)}</span>
      <span class="muted">${esc(s.published_at)} · ${esc(s.published_by_name || '?')}</span>
      <div class="spacer" style="flex:1"></div>
      <button class="small ghost view-snap" data-id="${s.id}">查看内容</button>
    </div>`).join('');
  el.querySelectorAll('.view-snap').forEach((btn) =>
    btn.addEventListener('click', () => viewSnapshot(btn.dataset.id)));
}

async function viewSnapshot(id) {
  const s = await api('/api/snapshots/' + id);
  $('#snap-title').textContent = `${s.payload.language_name} 快照 v${s.version}`;
  $('#snap-body').innerHTML =
    `<div class="snap-meta">发布于 ${esc(s.published_at)} · 快照 ID ${s.id}（内容不可变）</div>` +
    s.payload.entries.map((e) => `
      <div class="visitor-entry">
        <div class="meta">展签 #${e.label_id} · 原文 rev ${e.source_rev} · 译文 rev ${e.trans_rev}</div>
        <div class="zh">${esc(e.source_text)}</div>
        <div class="t">${esc(e.text)}</div>
      </div>`).join('');
  $('#snapshot-modal').hidden = false;
}

init().catch((e) => toast(e.message, true));
