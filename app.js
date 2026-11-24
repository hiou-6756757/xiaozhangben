import { toCents, parseBill, decodeBuffer } from './parser.js';

/* ============================ 常量 ============================ */
const LS_TX = 'ledger.tx.v1';
const LS_CFG = 'ledger.cfg.v1';

const DEFAULT_CATEGORIES = [
  { id: 'food',      name: '餐饮',   icon: '🍜', type: 'expense' },
  { id: 'transport', name: '交通',   icon: '🚌', type: 'expense' },
  { id: 'shopping',  name: '购物',   icon: '🛍️', type: 'expense' },
  { id: 'fun',       name: '娱乐',   icon: '🎮', type: 'expense' },
  { id: 'home',      name: '居住',   icon: '🏠', type: 'expense' },
  { id: 'telecom',   name: '通讯',   icon: '📶', type: 'expense' },
  { id: 'medical',   name: '医疗',   icon: '💊', type: 'expense' },
  { id: 'edu',       name: '学习',   icon: '📚', type: 'expense' },
  { id: 'gift',      name: '人情',   icon: '🎁', type: 'expense' },
  { id: 'digital',   name: '数码',   icon: '💻', type: 'expense' },
  { id: 'other',     name: '其他',   icon: '📦', type: 'expense' },
  { id: 'salary',    name: '工资',   icon: '💰', type: 'income' },
  { id: 'bonus',     name: '奖金',   icon: '🎉', type: 'income' },
  { id: 'redpacket', name: '红包',   icon: '🧧', type: 'income' },
  { id: 'invest',    name: '理财',   icon: '📈', type: 'income' },
  { id: 'refund',    name: '退款',   icon: '↩️', type: 'income' },
  { id: 'other_in',  name: '其他收入', icon: '➕', type: 'income' },
];

const DEFAULT_ACCOUNTS = [
  { id: 'wechat', name: '微信',   kind: 'wechat' },
  { id: 'alipay', name: '支付宝', kind: 'alipay' },
  { id: 'bank',   name: '银行卡', kind: 'bank' },
  { id: 'cash',   name: '现金',   kind: 'cash' },
];

/* ============================ 状态 ============================ */
const state = {
  view: 'overview',
  month: monthKey(new Date()),
  cfg: null,
  tx: [],
  editing: null,
  entryType: 'expense',
  entryCat: null,
  pendingImport: null,
};

/* ============================ 工具 ============================ */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function monthKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${y}年${Number(m)}月`;
}
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}
function fmt(cents) {
  const neg = cents < 0;
  const [i, f] = (Math.abs(cents) / 100).toFixed(2).split('.');
  const withSep = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg && withSep !== '0' ? '-' : '') + withSep + '.' + f;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, ms = 1600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function catOf(id) {
  return state.cfg.categories.find((c) => c.id === id) || { id: 'other', name: '其他', icon: '📦', type: 'expense' };
}
function acctOf(id) {
  return state.cfg.accounts.find((a) => a.id === id) || { id: 'cash', name: '现金', kind: 'cash' };
}
function save() {
  try {
    localStorage.setItem(LS_TX, JSON.stringify(state.tx));
    localStorage.setItem(LS_CFG, JSON.stringify(state.cfg));
  } catch (e) {
    toast('保存失败：存储空间可能已满');
  }
}
function load() {
  let tx = [];
  let cfg = null;
  try { tx = JSON.parse(localStorage.getItem(LS_TX) || '[]'); } catch (e) { tx = []; }
  try { cfg = JSON.parse(localStorage.getItem(LS_CFG) || 'null'); } catch (e) { cfg = null; }
  if (!cfg || !Array.isArray(cfg.categories) || !Array.isArray(cfg.accounts)) {
    cfg = { budget: 0, categories: DEFAULT_CATEGORIES.slice(), accounts: DEFAULT_ACCOUNTS.slice(), lastAccount: 'wechat' };
  }
  state.tx = Array.isArray(tx) ? tx : [];
  state.cfg = cfg;
  state.cfg.customCats = state.cfg.customCats || [];
  state.cfg.customAccts = state.cfg.customAccts || [];
}
function sortTx() {
  state.tx.sort((a, b) => (a.date === b.date ? (b.created || 0) - (a.created || 0) : a.date < b.date ? 1 : -1));
}
function monthTx(key) {
  return state.tx.filter((t) => (t.date || '').slice(0, 7) === key);
}
function sumBy(list, type) {
  return list.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
}

load();
sortTx();

/* ============================ 视图切换 ============================ */
const TITLES = { overview: '概览', list: '明细', stats: '统计', settings: '设置' };

function setView(view) {
  state.view = view;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  ['overview', 'list', 'stats', 'settings'].forEach((v) => {
    $('#view-' + v).classList.toggle('hidden', v !== view);
  });
  $('#pageTitle').textContent = TITLES[view];
  $('#monthNav').classList.toggle('hidden', view === 'settings');
  $('#monthLabel').textContent = monthLabel(state.month);
  $('#fabAdd').classList.toggle('hidden', view === 'settings' || view === 'stats');
  render();
}

function render() {
  if (state.view === 'overview') renderOverview();
  else if (state.view === 'list') renderList();
  else if (state.view === 'stats') renderStats();
  else renderSettings();
}

const PALETTE = ['#2f6bff', '#e5484d', '#f5a623', '#12a150', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
function barColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return PALETTE[h % PALETTE.length];
}

function emptyBlock() {
  return `<div class="empty"><b>还没有数据</b>点右下角 ＋ 记一笔，或在「设置」里导入微信 / 支付宝账单</div>`;
}

function txRow(t) {
  const c = t.type === 'transfer' ? { icon: '🔁', name: '转账' } : catOf(t.category);
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '';
  const cls = t.type === 'income' ? 'inc' : 'exp';
  const acc = acctOf(t.account);
  const srcTag = t.source && t.source !== 'manual'
    ? `<span class="tag">${t.source === 'wechat' ? '微信' : t.source === 'alipay' ? '支付宝' : t.source === 'bank' ? '银行' : esc(t.source)}</span>`
    : '';
  const sub = t.type === 'transfer' ? `${acc.name} → ${acctOf(t.toAccount).name}` : acc.name;
  return `<div class="tx" data-id="${t.id}">
    <div class="ico">${c.icon}</div>
    <div class="body">
      <div class="t1"><span class="cat">${esc(c.name)}</span>${t.note ? `<span class="note">${esc(t.note)}</span>` : ''}</div>
      <div class="meta">${esc(sub)}${srcTag}</div>
    </div>
    <div class="amt ${cls}">${sign}¥${fmt(t.amount)}</div>
  </div>`;
}

function bindTxRows(root) {
  root.querySelectorAll('.tx').forEach((el) => {
    el.onclick = () => openEntry(state.tx.find((t) => t.id === el.dataset.id));
  });
}

/* ============================ 概览 ============================ */
function renderOverview() {
  const list = monthTx(state.month);
  const exp = sumBy(list, 'expense');
  const inc = sumBy(list, 'income');
  const net = inc - exp;
  const budget = state.cfg.budget || 0;

  const byCat = {};
  list.filter((t) => t.type === 'expense').forEach((t) => {
    byCat[t.category] = (byCat[t.category] || 0) + t.amount;
  });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = cats.length ? cats[0][1] : 1;
  const recent = state.tx.slice(0, 5);

  $('#view-overview').innerHTML = `
    <div class="card">
      <div class="card-title">本月结余</div>
      <div class="balance" style="color:${net < 0 ? 'var(--expense)' : 'var(--text)'}">${net < 0 ? '-' : ''}¥${fmt(Math.abs(net))}</div>
      <div class="balance-sub">支出 ¥${fmt(exp)} · 收入 ¥${fmt(inc)}</div>
    </div>

    ${budget > 0 ? `
    <div class="card">
      <div class="card-title">本月预算</div>
      <div style="display:flex;justify-content:space-between;font-size:14px">
        <b>¥${fmt(exp)}</b><span style="color:var(--muted)">/ ¥${fmt(budget)}</span>
      </div>
      <div class="bar ${exp > budget ? 'over' : ''}"><i style="width:${Math.min(100, (exp / budget) * 100)}%"></i></div>
      <div class="budget-line">
        <span>${exp > budget ? '已超支' : '还可用'} ¥${fmt(Math.abs(budget - exp))}</span>
        <span>${Math.round((exp / budget) * 100)}%</span>
      </div>
    </div>` : `
    <div class="card">
      <div class="card-title">本月预算</div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--muted);font-size:13px">还没设置预算</span>
        <button class="text-btn primary" id="goBudget" type="button">去设置</button>
      </div>
    </div>`}

    <div class="card">
      <div class="card-title">支出构成</div>
      ${cats.length === 0 ? `<div class="empty" style="padding:18px 0">本月还没有支出记录</div>` : cats.map(([id, v]) => {
        const c = catOf(id);
        return `<div class="cat-row">
          <div class="ico">${c.icon}</div>
          <div class="mid">
            <div class="name"><b>${esc(c.name)}</b><span>¥${fmt(v)}</span></div>
            <div class="mini"><i style="width:${(v / max) * 100}%;background:${barColor(id)}"></i></div>
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>最近记录</span>
        <button class="text-btn primary" id="goList" type="button">全部</button>
      </div>
      ${recent.length === 0 ? emptyBlock() : recent.map(txRow).join('')}
    </div>
  `;

  const gb = $('#goBudget');
  if (gb) gb.onclick = () => setView('settings');
  const gl = $('#goList');
  if (gl) gl.onclick = () => setView('list');
  bindTxRows($('#view-overview'));
}

/* ============================ 明细 ============================ */
function renderList() {
  const list = monthTx(state.month).slice().sort((a, b) => (a.date === b.date ? (b.created || 0) - (a.created || 0) : a.date < b.date ? 1 : -1));
  const exp = sumBy(list, 'expense');
  const inc = sumBy(list, 'income');
  const groups = {};
  list.forEach((t) => { (groups[t.date] = groups[t.date] || []).push(t); });
  const days = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));

  $('#view-list').innerHTML = `
    <div class="card" style="display:flex;justify-content:space-around;text-align:center">
      <div><div class="balance-sub">支出</div><b class="val exp" style="font-size:17px">¥${fmt(exp)}</b></div>
      <div><div class="balance-sub">收入</div><b class="val inc" style="font-size:17px">¥${fmt(inc)}</b></div>
      <div><div class="balance-sub">笔数</div><b style="font-size:17px">${list.length}</b></div>
    </div>
    ${days.length === 0 ? emptyBlock() : `<div class="card" style="padding-top:4px;padding-bottom:4px">${days.map((d) => {
      const items = groups[d];
      const de = items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const di = items.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const wd = '日一二三四五六'[new Date(d + 'T00:00:00').getDay()];
      return `<div class="day-head"><span>${d.slice(5)} 周${wd}</span><span>${de ? '支 ¥' + fmt(de) : ''}${de && di ? ' · ' : ''}${di ? '收 ¥' + fmt(di) : ''}</span></div>
        ${items.map(txRow).join('')}`;
    }).join('')}</div>`}
  `;
  bindTxRows($('#view-list'));
}

/* ============================ 统计 ============================ */
function renderStats() {
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(state.month, -i));
  const series = months.map((m) => {
    const l = monthTx(m);
    return { m, exp: sumBy(l, 'expense'), inc: sumBy(l, 'income') };
  });
  const maxV = Math.max(1, ...series.map((s) => s.exp));

  const list = monthTx(state.month);
  const byCat = {};
  list.filter((t) => t.type === 'expense').forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const totalExp = sumBy(list, 'expense');
  const rank = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = rank.length ? rank[0][1] : 1;

  const acctRows = state.cfg.accounts.map((a) => {
    let inc = 0;
    let exp = 0;
    list.forEach((t) => {
      if (t.type === 'income' && t.account === a.id) inc += t.amount;
      if (t.type === 'expense' && t.account === a.id) exp += t.amount;
      if (t.type === 'transfer' && t.account === a.id) exp += t.amount;
      if (t.type === 'transfer' && t.toAccount === a.id) inc += t.amount;
    });
    return { a, inc, exp, net: inc - exp };
  }).filter((r) => r.inc || r.exp);

  $('#view-stats').innerHTML = `
    <div class="card">
      <div class="card-title">近 6 个月支出</div>
      <div class="chart">
        ${series.map((s) => `<div class="col ${s.m === state.month ? 'cur' : ''}">
          <div class="barwrap"><div class="b" style="height:${Math.max(2, (s.exp / maxV) * 100)}%"></div></div>
          <div class="m">${Number(s.m.slice(5))}月</div>
        </div>`).join('')}
      </div>
      <div class="budget-line"><span>本月支出 ¥${fmt(series[5].exp)}</span><span>6 个月合计 ¥${fmt(series.reduce((s, x) => s + x.exp, 0))}</span></div>
    </div>

    <div class="card">
      <div class="card-title">分类排行（本月）</div>
      ${rank.length === 0 ? `<div class="empty" style="padding:16px 0">本月还没有支出</div>` : rank.map(([id, v], i) => {
        const c = catOf(id);
        return `<div class="rank">
          <div class="no">${i + 1}</div>
          <div class="nm">${c.icon} ${esc(c.name)}</div>
          <div class="grow"><i style="width:${(v / maxCat) * 100}%;background:${barColor(id)}"></i></div>
          <div class="v">¥${fmt(v)} · ${Math.round((v / (totalExp || 1)) * 100)}%</div>
        </div>`;
      }).join('')}
    </div>

    <div class="card">
      <div class="card-title">账户流动（本月）</div>
      ${acctRows.length === 0 ? `<div class="empty" style="padding:16px 0">本月没有账户流水</div>` : acctRows.map((r) => `
        <div class="row"><span class="k">${esc(r.a.name)}</span>
        <span class="v">收 ¥${fmt(r.inc)} · 支 ¥${fmt(r.exp)} · 净 ${r.net < 0 ? '-' : ''}¥${fmt(Math.abs(r.net))}</span></div>`).join('')}
    </div>
  `;
}

/* ============================ 设置 ============================ */
function renderSettings() {
  const catsExp = state.cfg.categories.filter((c) => c.type === 'expense');
  const catsInc = state.cfg.categories.filter((c) => c.type === 'income');
  const chip = (c) => `<span class="chip">${c.icon} ${esc(c.name)}${state.cfg.customCats.includes(c.id) ? `<span class="x" data-del-cat="${c.id}">×</span>` : ''}</span>`;

  $('#view-settings').innerHTML = `
    <div class="card">
      <div class="card-title">每月预算</div>
      <div class="row" style="border:none;padding:0">
        <input id="budgetInput" type="text" inputmode="decimal" value="${state.cfg.budget ? (state.cfg.budget / 100).toFixed(2) : ''}"
          placeholder="不设置就留空" style="flex:1;border:1px solid var(--line);border-radius:11px;padding:10px;background:var(--bg);font-size:15px">
        <button class="text-btn primary" id="saveBudget" type="button" style="margin-left:8px">保存</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">导入账单</div>
      <div class="hint" style="margin-bottom:10px">从微信 / 支付宝导出 CSV 账单后选进来，会自动识别商户和金额、按关键词分类，并跳过重复记录。</div>
      <button class="btn primary" id="openImport" type="button">导入微信 / 支付宝账单</button>
    </div>

    <div class="card">
      <div class="card-title">支出分类</div>
      <div class="chip-list">${catsExp.map(chip).join('')}</div>
      <button class="ghost-btn" id="addCatExp" type="button" style="margin-top:10px">＋ 新增支出分类</button>
      <div class="field-label">收入分类</div>
      <div class="chip-list">${catsInc.map(chip).join('')}</div>
      <button class="ghost-btn" id="addCatInc" type="button" style="margin-top:10px">＋ 新增收入分类</button>
    </div>

    <div class="card">
      <div class="card-title">账户</div>
      <div class="chip-list">${state.cfg.accounts.map((a) => `<span class="chip">${esc(a.name)}${state.cfg.customAccts.includes(a.id) ? `<span class="x" data-del-acct="${a.id}">×</span>` : ''}</span>`).join('')}</div>
      <button class="ghost-btn" id="addAcct" type="button" style="margin-top:10px">＋ 新增账户</button>
    </div>

    <div class="card">
      <div class="card-title">数据</div>
      <button class="btn" id="exportJson" type="button">导出备份（JSON）</button>
      <label class="btn" style="margin-top:10px">导入备份
        <input id="importJson" type="file" accept=".json,application/json" hidden>
      </label>
      <button class="btn danger" id="clearAll" type="button">清空全部数据</button>
      <div class="hint" style="margin-top:12px">数据只存在这台手机的浏览器里，不会上传到任何服务器。换手机或清理浏览器前记得导出备份。</div>
    </div>

    <div class="card">
      <div class="card-title">关于</div>
      <div class="row" style="border:none;padding:4px 0"><span class="k">版本</span><span class="v">1.0</span></div>
      <div class="row" style="border:none;padding:4px 0"><span class="k">记录数</span><span class="v">${state.tx.length} 笔</span></div>
      <div class="hint" style="margin-top:8px">
        微信/支付宝没有面向个人的交易接口，所以本应用通过官方导出的账单文件导入，而不是实时读取。iPhone 也不允许网页读取通知或短信。
      </div>
    </div>
  `;

  $('#saveBudget').onclick = () => {
    const v = toCents($('#budgetInput').value || '0');
    state.cfg.budget = v;
    save();
    toast(v ? '预算已保存' : '已取消预算');
    renderSettings();
  };
  $('#openImport').onclick = openImport;
  $('#addCatExp').onclick = () => addCategory('expense');
  $('#addCatInc').onclick = () => addCategory('income');
  $('#addAcct').onclick = addAccount;
  $('#exportJson').onclick = exportJson;
  $('#importJson').onchange = importJson;
  $('#clearAll').onclick = clearAll;

  $('#view-settings').querySelectorAll('[data-del-cat]').forEach((el) => {
    el.onclick = () => delCategory(el.dataset.delCat);
  });
  $('#view-settings').querySelectorAll('[data-del-acct]').forEach((el) => {
    el.onclick = () => delAccount(el.dataset.delAcct);
  });
}

function addCategory(type) {
  const name = prompt(type === 'expense' ? '新支出分类名称' : '新收入分类名称');
  if (!name || !name.trim()) return;
  const id = 'c_' + uid();
  state.cfg.categories.push({ id, name: name.trim().slice(0, 8), icon: type === 'expense' ? '📦' : '➕', type });
  state.cfg.customCats.push(id);
  save();
  renderSettings();
  toast('已新增');
}
function delCategory(id) {
  const used = state.tx.filter((t) => t.category === id).length;
  if (used && !confirm(`这个分类下有 ${used} 笔记录，删除后它们会归到「其他」。继续？`)) return;
  state.tx.forEach((t) => { if (t.category === id) t.category = t.type === 'income' ? 'other_in' : 'other'; });
  state.cfg.categories = state.cfg.categories.filter((c) => c.id !== id);
  state.cfg.customCats = state.cfg.customCats.filter((x) => x !== id);
  save();
  renderSettings();
  toast('已删除');
}
function addAccount() {
  const name = prompt('新账户名称（如：招商银行、花呗）');
  if (!name || !name.trim()) return;
  const id = 'a_' + uid();
  state.cfg.accounts.push({ id, name: name.trim().slice(0, 10), kind: 'bank' });
  state.cfg.customAccts.push(id);
  save();
  renderSettings();
  toast('已新增');
}
function delAccount(id) {
  const used = state.tx.filter((t) => t.account === id || t.toAccount === id).length;
  if (used && !confirm(`这个账户下有 ${used} 笔记录，删除后它们会归到「现金」。继续？`)) return;
  state.tx.forEach((t) => { if (t.account === id) t.account = 'cash'; if (t.toAccount === id) t.toAccount = 'cash'; });
  state.cfg.accounts = state.cfg.accounts.filter((a) => a.id !== id);
  state.cfg.customAccts = state.cfg.customAccts.filter((x) => x !== id);
  save();
  renderSettings();
  toast('已删除');
}
function exportJson() {
  const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), cfg: state.cfg, tx: state.tx }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `账本备份-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('已导出');
}
function importJson(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.tx)) throw new Error('格式不对');
      if (!confirm(`将用备份里的 ${d.tx.length} 笔记录替换当前 ${state.tx.length} 笔，继续？`)) return;
      state.tx = d.tx;
      if (d.cfg && Array.isArray(d.cfg.categories)) state.cfg = Object.assign(state.cfg, d.cfg);
      save();
      sortTx();
      render();
      toast('已恢复');
    } catch (e) {
      toast('备份文件读不出来');
    }
  };
  r.readAsText(f);
  ev.target.value = '';
}
function clearAll() {
  if (!confirm('确定清空全部记录？这一步无法撤销，建议先导出备份。')) return;
  if (!confirm('再次确认：所有账目都会被删除。')) return;
  state.tx = [];
  state.cfg.budget = 0;
  save();
  render();
  toast('已清空');
}

/* ============================ 记一笔 ============================ */
function defaultCatOf(type) {
  const usable = state.cfg.categories.filter((x) => x.type === type);
  const c = usable.find((x) => x.id !== 'other' && x.id !== 'other_in' && x.id !== 'refund');
  return (c || usable[0] || { id: 'other' }).id;
}

function openEntry(tx) {
  state.editing = tx || null;
  state.entryType = tx ? tx.type : 'expense';
  state.entryCat = tx && tx.category ? tx.category : defaultCatOf(tx ? tx.type : 'expense');

  $('#entryTitle').textContent = tx ? '编辑' : '记一笔';
  $('#amountInput').value = tx ? (tx.amount / 100).toFixed(2) : '';
  $('#dateInput').value = tx ? tx.date : todayStr();
  $('#noteInput').value = tx ? (tx.note || '') : '';
  $('#entryDelete').classList.toggle('hidden', !tx);

  const accts = state.cfg.accounts;
  const opts = accts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  $('#accountSelect').innerHTML = opts;
  $('#toAccountSelect').innerHTML = opts;
  $('#accountSelect').value = tx ? tx.account : (state.cfg.lastAccount || 'wechat');
  $('#toAccountSelect').value = tx && tx.toAccount ? tx.toAccount : 'wechat';

  syncEntryUI();

  $('#backdrop').classList.remove('hidden');
  $('#entrySheet').classList.remove('hidden');
  if (!tx) setTimeout(() => $('#amountInput').focus(), 260);
}

function syncEntryUI() {
  $$('#typeSeg .seg-item').forEach((b) => b.classList.toggle('active', b.dataset.type === state.entryType));
  const showCat = state.entryType !== 'transfer';
  $('#catChips').classList.toggle('hidden', !showCat);
  $('#catChips').previousElementSibling.classList.toggle('hidden', !showCat);
  if (showCat) {
    const cats = state.cfg.categories.filter((c) => c.type === state.entryType);
    $('#catChips').innerHTML = cats.map((c) =>
      `<button class="c ${c.id === state.entryCat ? 'active' : ''}" data-cat="${c.id}" type="button">${c.icon} ${esc(c.name)}</button>`).join('');
    $$('#catChips .c').forEach((b) => {
      b.onclick = () => { state.entryCat = b.dataset.cat; syncEntryUI(); };
    });
  }
  $('#toAccountField').classList.toggle('hidden', state.entryType !== 'transfer');
}

function closeEntry() {
  $('#entrySheet').classList.add('hidden');
  $('#backdrop').classList.add('hidden');
  state.editing = null;
}

function saveEntry() {
  const amt = toCents($('#amountInput').value);
  if (!amt) { toast('请输入金额'); $('#amountInput').focus(); return; }
  const date = $('#dateInput').value || todayStr();
  const note = $('#noteInput').value.trim();
  const account = $('#accountSelect').value;
  const toAccount = $('#toAccountSelect').value;
  if (state.entryType === 'transfer' && toAccount === account) { toast('转出和转入是同一个账户'); return; }

  const base = {
    amount: amt,
    date,
    note,
    account,
    type: state.entryType,
    category: state.entryType === 'transfer' ? '' : state.entryCat,
    toAccount: state.entryType === 'transfer' ? toAccount : '',
  };
  const wasEditing = Boolean(state.editing);
  if (wasEditing) Object.assign(state.editing, base);
  else state.tx.push(Object.assign({ id: uid(), created: Date.now(), source: 'manual' }, base));

  state.cfg.lastAccount = account;
  sortTx();
  save();
  closeEntry();
  render();
  toast(wasEditing ? '已保存' : '记好了');
}

/* ============================ 账单导入 ============================ */
function openImport() {
  state.pendingImport = null;
  $('#importPreview').innerHTML = '';
  $('#importCommit').classList.add('hidden');
  $('#importText').value = '';
  $('#backdrop').classList.remove('hidden');
  $('#importSheet').classList.remove('hidden');
}
function closeImport() {
  $('#importSheet').classList.add('hidden');
  $('#backdrop').classList.add('hidden');
  state.pendingImport = null;
}

function showImportPreview(parsed, fileName) {
  const existing = new Set(state.tx.map((t) => t.dedupe).filter(Boolean));
  const seen = new Set();
  let dup = 0;
  const fresh = [];
  for (const r of parsed.rows) {
    if (existing.has(r.dedupe) || seen.has(r.dedupe)) { dup++; continue; }
    seen.add(r.dedupe);
    fresh.push(r);
  }
  state.pendingImport = fresh;

  const totalExp = fresh.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const totalInc = fresh.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const srcLabel = parsed.source === 'wechat' ? '微信支付' : '支付宝';

  $('#importPreview').innerHTML = `
    <div class="hint" style="margin-top:12px">识别为<b>${srcLabel}</b>账单${fileName ? `（${esc(fileName)}）` : ''}</div>
    <div class="imp-sum">
      <div><b>${fresh.length}</b><span>可导入</span></div>
      <div><b>${dup}</b><span>重复跳过</span></div>
      <div><b>${parsed.skipped.status + parsed.skipped.parse}</b><span>忽略</span></div>
    </div>
    <div class="budget-line" style="margin:8px 0 4px"><span>支出合计</span><span>收入合计</span></div>
    <div class="budget-line" style="margin:0 0 10px"><b>¥${fmt(totalExp)}</b><b>¥${fmt(totalInc)}</b></div>
    ${fresh.slice(0, 12).map((r) => `<div class="imp-row">
      <span class="d">${r.date.slice(5)}</span>
      <span class="m">${catOf(r.category).icon} ${esc((r.merchant || r.desc || '未命名').slice(0, 18))}</span>
      <span class="a" style="color:${r.type === 'income' ? 'var(--income)' : 'var(--text)'}">${r.type === 'income' ? '+' : '-'}${fmt(r.amount)}</span>
    </div>`).join('')}
    ${fresh.length > 12 ? `<div class="budget-line"><span>只预览前 12 条</span><span>共 ${fresh.length} 条</span></div>` : ''}
    ${fresh.length === 0 ? `<div class="empty" style="padding:16px 0">没有新的记录可导入</div>` : ''}
  `;
  $('#importCommit').classList.toggle('hidden', fresh.length === 0);
}

function commitImport() {
  const list = state.pendingImport || [];
  if (!list.length) return;
  const accountExists = (id) => state.cfg.accounts.some((a) => a.id === id);
  list.forEach((r) => {
    const acct = r.source === 'wechat' ? 'wechat' : 'alipay';
    state.tx.push({
      id: uid(), created: Date.now(), source: r.source,
      amount: r.amount, date: r.date, type: r.type, category: r.category,
      account: accountExists(acct) ? acct : 'cash', toAccount: '',
      note: r.note || '', dedupe: r.dedupe,
    });
  });
  sortTx();
  save();
  closeImport();
  render();
  toast(`已导入 ${list.length} 笔`);
}

/* ============================ 事件绑定 ============================ */
$$('.tab').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
$('#fabAdd').onclick = () => openEntry(null);
$('#entryCancel').onclick = closeEntry;
$('#entrySave').onclick = saveEntry;
$('#backdrop').onclick = () => { closeEntry(); closeImport(); };
$('#entryDelete').onclick = () => {
  if (!state.editing) return;
  if (!confirm('删除这笔记录？')) return;
  state.tx = state.tx.filter((t) => t.id !== state.editing.id);
  save();
  closeEntry();
  render();
  toast('已删除');
};
$$('#typeSeg .seg-item').forEach((b) => {
  b.onclick = () => {
    state.entryType = b.dataset.type;
    if (state.entryType !== 'transfer' && !state.cfg.categories.some((c) => c.id === state.entryCat && c.type === state.entryType)) {
      state.entryCat = defaultCatOf(state.entryType);
    }
    syncEntryUI();
  };
});
$('#monthNav').onclick = (e) => {
  const chev = e.target.closest('[data-month]');
  if (!chev) return;
  state.month = shiftMonth(state.month, Number(chev.dataset.month));
  $('#monthLabel').textContent = monthLabel(state.month);
  render();
};
$('#importCancel').onclick = closeImport;
$('#importCommit').onclick = commitImport;
$('#importFile').onchange = (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const parsed = parseBill(decodeBuffer(r.result));
      showImportPreview(parsed, f.name);
    } catch (e) {
      $('#importPreview').innerHTML = `<div class="hint" style="margin-top:12px;color:var(--expense)">解析失败：${esc(e.message)}</div>`;
    }
  };
  r.readAsArrayBuffer(f);
  ev.target.value = '';
};
$('#importParse').onclick = () => {
  const text = $('#importText').value;
  if (!text.trim()) { toast('先把账单内容粘进来'); return; }
  try {
    showImportPreview(parseBill(text), '');
  } catch (e) {
    $('#importPreview').innerHTML = `<div class="hint" style="margin-top:12px;color:var(--expense)">解析失败：${esc(e.message)}</div>`;
  }
};

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

setView('overview');
