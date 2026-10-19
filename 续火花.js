/**
 * 抖音续火花（早八自动化）
 * ------------------------------------------------------------
 * 核心逻辑：
 *   1) 打开抖音网页私信页 https://www.douyin.com/chat ，扫码登录一次，登录态存本机；
 *   2) 自动滚动会话列表，逐条识别「有没有火花」（有火花的才需要续，没有的完全不碰）；
 *   3) 对每个有火花的好友，从话术库里随机挑一句发过去（话术可自己编辑，一行一句）；
 *   4) 全程模拟真人在网页上打字发送，不碰第三方协议、不装外挂。
 *
 * 用法：
 *   node 续火花.js --login    第一次：打开浏览器等你扫码登录
 *   node 续火花.js --scan     扫描全部会话，导出「谁有火花」清单（不发消息）
 *   node 续火花.js --check    只检查：登录态 + 识别到几个有火花的好友
 *   node 续火花.js            正式续火花（只发给有火花的人）
 *   node 续火花.js --force    今天已经发过也再发
 *   node 续火花.js --dump     出错时保存截图 + HTML，方便排查
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { chromium } = require('playwright-core');

const ROOT = __dirname;
const CFG_PATH = path.join(ROOT, '配置.json');
const LOG_DIR = path.join(ROOT, '日志');
const STATE_DIR = path.join(ROOT, '状态');
const PROFILE_DIR = path.join(ROOT, '浏览器数据');
[LOG_DIR, STATE_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const ARGS = process.argv.slice(2);
const FLAG = {
  login: ARGS.includes('--login'),
  scan: ARGS.includes('--scan'),
  check: ARGS.includes('--check'),
  force: ARGS.includes('--force'),
  dump: ARGS.includes('--dump'),
  now: ARGS.includes('--now'),
};

/* ───────────────── 日志 ───────────────── */
const LOG_FILE = path.join(LOG_DIR, '运行日志.txt');
function log(msg) {
  const t = new Date().toLocaleString('zh-CN', { hour12: false });
  const line = '[' + t + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\r\n', 'utf8'); } catch (e) {}
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

/* ───────────────── 配置 ───────────────── */
const DEFAULT_CFG = {
  模式: 'auto',
  只发这些: [],
  排除这些: [],
  优先这些: [],
  每天最多发几个: 0,   // 0 = 不限制（有火花的人必须每天都发，少一个就断一个）
  每人发送间隔秒: [20, 60],
  随机延迟分钟: 30,
  等待回复秒数: 60,
  话术文件: '话术.txt',
  火花关键词: ['火花', '火苗'],
  把最近互动也当火花: true,
  最近互动天数: 2,
  浏览器: 'msedge',
  显示浏览器窗口: true,
};

function loadCfg() {
  if (!fs.existsSync(CFG_PATH)) {
    fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULT_CFG, null, 2), 'utf8');
    log('ℹ 已生成默认 配置.json');
  }
  return Object.assign({}, DEFAULT_CFG, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')));
}

/** 话术库：优先 话术文件夹里的当前使用文件，# 开头是注释，一行一句 */
function loadLines(cfg) {
  const cand = [
    path.join(ROOT, cfg.话术文件 || '话术/当前使用.txt'),
    path.join(ROOT, '话术', '当前使用.txt'),
    path.join(ROOT, '话术.txt'),
  ];
  for (const p of cand) {
    if (!fs.existsSync(p)) continue;
    const arr = fs.readFileSync(p, 'utf8').split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#'));
    if (arr.length) return arr;
  }
  const js = path.join(ROOT, '文案库.json');
  if (fs.existsSync(js)) {
    try {
      const arr = JSON.parse(fs.readFileSync(js, 'utf8'));
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {}
  }
  return ['今天过得怎么样呀'];
}

/* ───────────────── 话术选择器（--pick） ───────────────── */
function pickScript() {
  const dir = path.join(ROOT, '话术');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const files = fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.txt'))
    .filter(f => f !== '当前使用.txt' && !f.startsWith('历史'));
  const cur = path.join(dir, '当前使用.txt');
  const readLines = p => fs.readFileSync(p, 'utf8').split(/\r?\n/)
    .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  let curText = '';
  try { curText = fs.readFileSync(cur, 'utf8'); } catch (e) {}

  console.log('\n========= 话术库选择 =========');
  files.forEach((f, i) => {
    const p = path.join(dir, f);
    const lines = readLines(p);
    const isCur = f === '当前使用.txt' ? '' : (fs.readFileSync(p, 'utf8') === curText ? '  ← 当前使用' : '');
    console.log('  ' + (i + 1) + ') ' + f + '（' + lines.length + ' 句）' + isCur);
    if (lines.length) console.log('      示例：' + lines[0].slice(0, 34));
  });
  console.log('--------------------------------');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('输入编号切换（直接回车退出）：', ans => {
    const i = parseInt((ans || '').trim(), 10) - 1;
    if (i >= 0 && i < files.length) {
      fs.copyFileSync(path.join(dir, files[i]), cur);
      console.log('\n✅ 已切换为「' + files[i] + '」');
      console.log('   也可以用记事本打开 话术\\当前使用.txt 自己加句子');
    } else {
      console.log('\n（未切换）');
    }
    rl.close();
  });
}

/** 随机挑一条，避开最近 15 条（同一句话反复发容易被判低质互动） */
function pickMessage(pool) {
  const rec = path.join(STATE_DIR, '最近话术.json');
  let recent = [];
  try { recent = JSON.parse(fs.readFileSync(rec, 'utf8')); } catch (e) {}
  const fresh = pool.filter(m => !recent.includes(m));
  const list = fresh.length ? fresh : pool;
  const pick = list[Math.floor(Math.random() * list.length)];
  recent.push(pick);
  while (recent.length > 15) recent.shift();
  fs.writeFileSync(rec, JSON.stringify(recent, null, 2), 'utf8');
  return pick;
}

const todayKey = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const todayFile = () => path.join(STATE_DIR, '已发送_' + todayKey() + '.json');
function loadSent() {
  try { return JSON.parse(fs.readFileSync(todayFile(), 'utf8')); } catch (e) { return []; }
}

/* ───────────────── 登录 ───────────────── */
async function hasSession(ctx) {
  try {
    const cookies = await ctx.cookies('https://www.douyin.com');
    return cookies.some(c => (c.name === 'sessionid' || c.name === 'sessionid_ss') && c.value);
  } catch (e) { return false; }
}
async function waitLogin(ctx, sec) {
  log('👉 请在弹出的浏览器里用手机抖音扫码登录（最多等 ' + sec + ' 秒）');
  const t0 = Date.now();
  while (Date.now() - t0 < sec * 1000) {
    if (await hasSession(ctx)) { log('✅ 登录成功，登录态已保存'); return true; }
    await sleep(3000);
  }
  return false;
}

async function openChat(page) {
  log('🌐 打开抖音私信页 …');
  await page.goto('https://www.douyin.com/chat', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4500);
  for (const t of ['以后再说', '暂不', '我知道了', '取消']) {
    const b = page.locator('text=' + t).first();
    if (await b.count().catch(() => 0) && await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 1200 }).catch(() => {});
      await sleep(400);
    }
  }
}

/* ───────────────── 会话列表 ───────────────── */
/** 等左侧列表从「骨架屏」变成真实文字（抖音聊天页是重型 SPA，加载要好几秒） */
async function waitListReady(page, timeoutSec = 45) {
  const t0 = Date.now();
  let last = 0;
  while (Date.now() - t0 < timeoutSec * 1000) {
    const n = await page.evaluate(() => {
      let c = 0;
      for (const el of document.querySelectorAll('div,li,a')) {
        const r = el.getBoundingClientRect();
        if (r.left > 470 || r.width < 150 || r.width > 460 || r.height < 36 || r.height > 120) continue;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length >= 2 && t.length <= 80) c++;
      }
      return c;
    }).catch(() => 0);
    if (n >= 3 && n === last) { log('📋 会话列表已加载（读到 ' + n + ' 条候选）'); return true; }
    last = n;
    await sleep(2500);
  }
  log('⚠ 列表 ' + timeoutSec + ' 秒内没加载完整（可能网络慢）');
  return false;
}

/** 找左侧列表滚动容器（页面里可能有多个，取左栏那个） */
const SCROLL_FN = `(() => {
  const es = [...document.querySelectorAll('div')].filter(e => {
    const r = e.getBoundingClientRect();
    if (r.left > 470 || r.width < 180 || r.height < 200) return false;
    const s = getComputedStyle(e);
    return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 40;
  });
  return es[0] || null;
})()`;

async function scrollList(page, to) {
  return await page.evaluate(`(() => {
    const b = ${SCROLL_FN};
    if (!b) return -1;
    ${to === 'top' ? 'b.scrollTop = 0;' : 'b.scrollTop += b.clientHeight * 0.8;'}
    return b.scrollTop;
  })()`);
}
async function listAtBottom(page) {
  return await page.evaluate(`(() => {
    const b = ${SCROLL_FN};
    if (!b) return true;
    return b.scrollTop + b.clientHeight >= b.scrollHeight - 5;
  })()`);
}

/** 从顶部开始边滚边收集全部会话（列表是虚拟渲染，滚到底后顶部条目会从 DOM 卸载，
 *  所以必须"读一段、滚一段"地累积 —— 火花好友都排在最顶上，绝不能直接拉到底） */
async function collectAllRows(page, keywords, recentDays, maxRound = 40) {
  await scrollList(page, 'top');
  await sleep(1000);
  const map = new Map();
  for (let i = 0; i < maxRound; i++) {
    const rows = await readConversations(page, keywords, recentDays);
    for (const r of rows) {
      const key = r.name + '|' + r.time;
      if (!map.has(key)) map.set(key, r);
    }
    await scrollList(page, 'down');
    await sleep(900);
    if (await listAtBottom(page)) {
      const tail = await readConversations(page, keywords, recentDays);
      for (const r of tail) {
        const key = r.name + '|' + r.time;
        if (!map.has(key)) map.set(key, r);
      }
      break;
    }
  }
  // 回到顶部，方便后续按名字点开会话（火花好友都在顶上）
  await scrollList(page, 'top');
  await sleep(800);
  return [...map.values()];
}

/** 抓左侧每一条会话（2026-10-19 实测结构）：
 *  行容器 class 形如 conversationConversationItemrowArea2
 *  第一行=昵称，第二行=时间，之后=最后一条消息
 *  昵称旁的徽标区 class 含 TagNextToTitle —— 火花图标应该出现在这里 */
async function readConversations(page, keywords, recentDays) {
  const rows = await page.evaluate(({ kw, days }) => {
    function isRecent(t, dayLimit) {
      if (!t) return false;
      const now = new Date();
      if (/今天|刚刚|分钟前|小时前/.test(t)) return true;
      if (/昨天/.test(t)) return dayLimit >= 1;
      let m = t.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
      let y, mo, d;
      if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else {
        m = t.match(/(\d{1,2})[\/\-.](\d{1,2})/);
        if (!m) return false;
        y = now.getFullYear(); mo = +m[1]; d = +m[2];
      }
      const dt = new Date(y, mo - 1, d);
      const diff = (now - dt) / 86400000;
      return diff >= 0 && diff <= dayLimit;
    }
    const out = [];
    const seen = new Set();
    const els = document.querySelectorAll('div[class*="ConversationItemrowArea"], div[class*="ConversationItemrow"]');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 30) continue;
      // 昵称取标题元素本身（避免把「AI分身」之类的徽标当成昵称）
      const titleEl = el.querySelector('[class*="ConversationItemtitle"]:not([class*="Wrapper"])');
      const name = ((titleEl && titleEl.innerText) || '').replace(/\s+/g, ' ').trim()
        || (el.innerText || '').split('\n')[0].trim();
      if (!name || name.length > 40) continue;
      const lines = (el.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      const time = lines.find(l => /\d{1,4}[\/\-.年]\d{1,2}/.test(l) || /今天|昨天|周/.test(l)) || '';
      const lastMsg = lines.filter(l => l !== name && l !== time).join(' ');
      const key = name + '|' + time;
      if (seen.has(key)) continue;
      seen.add(key);
      const tagEls = [...el.querySelectorAll('[class*="TagNextToTitle"]')];
      const tagHtml = tagEls.map(n => n.outerHTML).join('');
      // ⚠ 只看昵称旁的「徽标区」，绝不能用整行文字判火花 ——
      // 消息预览里可能带 🔥 表情或"点亮聊天火花"系统消息（2026-10-19 讯江洋/老虎頭 误报实锤）
      const tagText = tagEls.map(n => (n.innerText || '')).join(' ');
      // 火花徽标的图标类名就是 commonStreakicon / commonStreakstreakContainer（实测）
      const SPARK_RE = /🔥|火花|火苗|重燃中|天后消失/;
      const hasSpark = /commonStreak/i.test(tagHtml) || SPARK_RE.test(tagText) ||
        /spark|fire|huo|flame|blaze|hot/i.test(tagHtml);
      // 火花天数：徽标里开头的数字（如 245）；重燃中/将消失另记
      const mStreak = tagText.match(/^\s*(\d{1,4})\b/);
      const streak = mStreak ? mStreak[1]
        : /重燃中/.test(tagText) ? '重燃中'
        : /天后消失/.test(tagText) ? '将消失' : '';
      const recent = isRecent(time, days);
      out.push({ name, time, lastMsg, hasSpark, recent, streak,
        tagHtml: tagHtml.slice(0, 800), top: Math.round(r.top) });
    }
    return out;
  }, { kw: keywords, days: Number(recentDays) || 2 });
  if (rows.length) return rows;
  // 兜底：类名变了就走老启发式
  return await page.evaluate((kw) => {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('div,li,a')) {
      const r = el.getBoundingClientRect();
      if (r.left > 470 || r.width < 150 || r.width > 460 || r.height < 36 || r.height > 120) continue;
      const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 120) continue;
      const childSame = [...el.children].some(c => ((c.innerText || '').replace(/\s+/g, ' ').trim()) === txt);
      if (childSame) continue;
      const key = Math.round(r.top) + '|' + txt;
      if (seen.has(key)) continue;
      seen.add(key);
      const imgs = [...el.querySelectorAll('img,svg,i,span')].map(n => (n.getAttribute('src') || '') + '|'
        + (n.getAttribute('alt') || '') + '|' + (n.className && n.className.baseVal !== undefined ? n.className.baseVal : (n.className || '')));
      const hasSpark = kw.some(k => txt.includes(k)) ||
        imgs.some(s => /spark|fire|huo|hot|flame|blaze|match/i.test(s));
      out.push({ name: txt.split(' ')[0], time: '', lastMsg: txt, hasSpark, recent: false, tagHtml: '', top: Math.round(r.top) });
    }
    return out.filter(r => r.name.length >= 1);
  }, keywords);
}

/* ───────────────── 会话内操作 ───────────────── */
async function findEditor(page) {
  for (const sel of ['div[contenteditable="true"]', 'textarea[placeholder]', 'textarea']) {
    const loc = page.locator(sel).last();
    if (await loc.count().catch(() => 0) && await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

async function openConversation(page, name) {
  // 目标（有火花的人）都在列表顶部，先回顶再找
  await scrollList(page, 'top').catch(() => {});
  await sleep(600);
  // ① 用真实行容器类名定位（2026-10-19 实测）
  const row = page.locator('div[class*="ConversationItemrowArea"]', { hasText: name }).first();
  if (await row.count().catch(() => 0)) {
    await row.click({ timeout: 5000 }).catch(() => {});
    await sleep(1600);
    return !!(await findEditor(page));
  }
  // ② 会话列表文字直接点
  const item = page.locator('text=' + name).first();
  if (await item.count().catch(() => 0) && await item.isVisible().catch(() => false)) {
    await item.click({ timeout: 5000 }).catch(() => {});
    await sleep(1600);
    return !!(await findEditor(page));
  }
  const search = page.locator('input[placeholder*="搜索"]').first();
  if (await search.count().catch(() => 0) && await search.isVisible().catch(() => false)) {
    await search.click().catch(() => {});
    await search.fill('').catch(() => {});
    await search.type(name, { delay: 70 }).catch(() => {});
    await sleep(2500);
    const hit = page.locator('text=' + name).first();
    if (await hit.count().catch(() => 0)) {
      await hit.click().catch(() => {});
      await sleep(1800);
      return !!(await findEditor(page));
    }
  }
  return false;
}

async function sendText(page, text) {
  const editor = await findEditor(page);
  if (!editor) throw new Error('找不到输入框');
  await editor.click();
  await sleep(rnd(300, 900));
  await page.keyboard.type(text, { delay: Math.round(rnd(45, 110)) });
  await sleep(rnd(400, 1200));
  await page.keyboard.press('Enter');
  await sleep(2000);
  const left = ((await editor.innerText().catch(() => '')) || '').trim();
  if (left.includes(text.slice(0, 6))) {
    const btn = page.locator('button:has-text("发送"), [data-e2e*="send"]').first();
    if (await btn.count().catch(() => 0)) { await btn.click().catch(() => {}); await sleep(1800); }
  }
}

async function dump(page, tag) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = path.join(LOG_DIR, tag + '_' + ts);
  try {
    await page.screenshot({ path: base + '.png' });
    fs.writeFileSync(base + '.html', await page.content(), 'utf8');
    log('📄 诊断文件：' + path.basename(base) + '.png / .html');
    return base;
  } catch (e) { return null; }
}

/* ───────────────── 主流程 ───────────────── */
(async () => {
  if (ARGS.includes('--pick')) { pickScript(); return; }
  const cfg = loadCfg();
  const mode = FLAG.login ? 'login' : FLAG.scan ? 'scan' : FLAG.check ? 'check' : 'send';
  log('========== 抖音续火花 · ' + mode + ' ==========');

  if (mode === 'send') {
    const sent = loadSent();
    if (sent.length && !FLAG.force) {
      log('✅ 今天已处理过 ' + sent.length + ' 位好友（' + todayKey() + '），跳过。加 --force 可重发');
      return;
    }
    if (cfg.随机延迟分钟 > 0 && !FLAG.now) {
      const m = rnd(0, cfg.随机延迟分钟);
      log('⏳ 随机等待 ' + m.toFixed(1) + ' 分钟再开始（避开固定时间点）');
      await sleep(m * 60 * 1000);
    }
  }

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: cfg.浏览器 || 'msedge',
    headless: !cfg.显示浏览器窗口,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--lang=zh-CN'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  try {
    await openChat(page);

    if (!(await hasSession(ctx))) {
      const ok = await waitLogin(ctx, mode === 'login' ? 300 : 150);
      if (!ok) { log('✗ 没登录成功，先双击「一键-登录抖音.bat」'); await dump(page, '未登录'); return; }
      await openChat(page);
    } else {
      log('✅ 登录态有效');
    }
    if (mode === 'login') { log('🎉 登录态已保存，可以关窗口了'); await sleep(2500); return; }

    log('📜 从顶部开始收集全部会话（火花好友都在最上面）…');
    await waitListReady(page, 45);
    let rows = await collectAllRows(page, cfg.火花关键词, cfg.最近互动天数);
    rows = rows.filter(r => r.name && r.name.length <= 40);
    const sparks = rows.filter(r => r.hasSpark);
    const recents = rows.filter(r => !r.hasSpark && r.recent);
    log('📋 会话 ' + rows.length + ' 条：识别到火花 ' + sparks.length + ' 条，近期互动 ' + recents.length + ' 条');
    sparks.slice(0, 25).forEach(r => log('   🔥 ' + r.name + (r.streak ? '（' + r.streak + '）' : '') + '（' + (r.time || '?') + '）'));
    recents.slice(0, 20).forEach(r => log('   💬 ' + r.name + '（' + (r.time || '?') + '）'));

    if (mode === 'scan') {
      const out = path.join(STATE_DIR, '会话扫描_' + todayKey() + '.json');
      fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2), 'utf8');
      log('📄 已导出：' + out);
      await dump(page, '扫描');
      return;
    }

    if (mode === 'check') {
      log('✅ 检查完成：登录正常，能读到会话列表');
      await dump(page, '检查');
      return;
    }

    /* ── 正式发送 ── */
    const white = (cfg.只发这些 || []).filter(Boolean);
    const black = (cfg.排除这些 || []).filter(Boolean);
    // 目标 = 有火花标记的；若开了「最近互动兜底」，近几天聊过的也纳入
    //（有火花必然近期互聊过，反之近期聊过的基本都带着火花 —— 双保险）
    let targets = (cfg.模式 === 'auto'
      ? rows.filter(r => r.hasSpark || (cfg.把最近互动也当火花 && r.recent))
      : rows)
      .filter(r => !black.some(b => r.name.includes(b)))
      .filter(r => white.length === 0 || white.some(w => r.name.includes(w)));
    const maxN = Number(cfg.每天最多发几个 || 0);
    // maxN <= 0 表示不限制 —— 有火花的人必须天天发，砍掉谁就是断谁的火花
    const pri = (cfg.优先这些 || []).filter(Boolean);
    if (pri.length) {
      targets.sort((a, b) => (pri.some(p => a.name.includes(p)) ? 0 : 1) - (pri.some(p => b.name.includes(p)) ? 0 : 1));
      log('⭐ 优先发送：' + targets.filter(t => pri.some(p => t.name.includes(p))).map(t => t.name).join('、'));
    }
    if (maxN > 0 && targets.length > maxN) {
      targets = targets.sort(() => Math.random() - 0.5).slice(0, maxN);
      log('🎯 有火花的好友较多，今天随机挑 ' + maxN + ' 个发送');
    }
    if (!targets.length) {
      log('ℹ 没找到需要续火花的好友（可能今天都已经有互动，或者识别规则要调 —— 先跑 --scan 看看）');
      await dump(page, '无目标');
      return;
    }

    const pool = loadLines(cfg);
    log('🗣 话术库：' + cfg.话术文件 + '（' + pool.length + ' 句）');
    const sent = loadSent();
    const [gapMin, gapMax] = cfg.每人发送间隔秒 || [20, 60];
    let okCount = 0;

    for (const t of targets) {
      if (sent.some(s => s.name === t.name)) { log('↩ 今天已发给「' + t.name + '」，跳过'); continue; }
      const text = pickMessage(pool);
      log('✍ 发送给「' + t.name + '」：' + text);
      const opened = await openConversation(page, t.name);
      if (!opened) { log('⚠ 打不开与「' + t.name + '」的会话，跳过'); continue; }
      try {
        await sendText(page, text);
        okCount++;
        sent.push({ name: t.name, text, at: new Date().toISOString() });
        fs.writeFileSync(todayFile(), JSON.stringify(sent, null, 2), 'utf8');
        log('✅ 已发送（今天累计 ' + okCount + ' 个）');
      } catch (e) {
        log('⚠ 发送失败：' + e.message);
      }
      const gap = rnd(gapMin, gapMax);
      log('⏳ 间隔 ' + gap.toFixed(0) + ' 秒再处理下一位');
      await sleep(gap * 1000);
    }

    await dump(page, '完成');
    log('🎉 本次结束，共发给 ' + okCount + ' 位有火花的好友');

    const waitSec = Number(cfg.等待回复秒数 || 0);
    if (waitSec > 0 && okCount) {
      log('⏳ 等待 ' + waitSec + ' 秒观察是否有人回 …');
      await sleep(waitSec * 1000);
      log('ℹ 火花需要「双方各发一条」，对方不回的话记得自己催一句');
    }
  } catch (e) {
    log('✗ 出错：' + e.message);
    if (FLAG.dump) await dump(page, '出错');
    process.exitCode = 1;
  } finally {
    await sleep(600);
    await ctx.close().catch(() => {});
    log('========== 结束 ==========');
  }
})();
