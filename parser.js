/* 账单解析：纯函数，不碰 DOM，方便单独测试。 */
import { decodeGBK } from './gbk.js';

/** 关键词 -> 分类。匹配「交易对方 + 商品说明 + 备注」。越靠前优先级越高。 */
export const RULES = [
  ['food',      ['美团', '饿了么', '肯德基', '麦当劳', '星巴克', '瑞幸', '咖啡', '奶茶', '餐厅', '饭店', '外卖', '食堂', '烧烤', '火锅', '面馆', '小吃', '汉堡', '披萨', '沙县', '海底捞', '烘焙', '蛋糕', '便利蜂', '蜜雪冰城', '茶百道', '古茗', '霸王茶姬', '老乡鸡', '真功夫', '塔斯汀', '华莱士']],
  ['transport', ['滴滴', '高德打车', '地铁', '公交', '出租车', '打车', '加油', '中国石化', '中国石油', '停车', 'ETC', '火车票', '12306', '机票', '航空', '共享单车', '哈啰', '青桔', '美团单车', '高速', '网约车', '曹操出行', 'T3出行']],
  ['shopping',  ['淘宝', '天猫', '京东', '拼多多', '唯品会', '苏宁', '超市', '商城', '便利店', '名创优品', '优衣库', '盒马', '山姆', '沃尔玛', '永辉', '屈臣氏', '百货', '专卖店', '旗舰店', '得物', '闲鱼']],
  ['fun',       ['电影', '影城', '万达', '游戏', 'steam', '腾讯视频', '爱奇艺', '优酷', '哔哩哔哩', 'bilibili', 'ktv', '剧本杀', '网吧', '演出', '门票', '网易', '米哈游', '会员', '芒果tv', '音乐']],
  ['home',      ['房租', '物业', '水费', '电费', '燃气', '暖气', '家政', '维修', '装修', '租金', '供电', '供水', '水务', '热力']],
  ['telecom',   ['话费', '中国移动', '中国联通', '中国电信', '宽带', '流量', '充值', '通信']],
  ['medical',   ['医院', '药店', '药房', '诊所', '挂号', '体检', '牙科', '医疗', '医保', '大药房', '卫生院']],
  ['edu',       ['学费', '培训', '书店', '图书', '课程', '学而思', '新东方', '教育', '考试', '报名费', '驾校']],
  ['digital',   ['apple', '苹果', '华为', '小米', '数码', '电脑', '手机', '配件', '耳机', '显示器', '键盘', '相机']],
  ['gift',      ['红包', '转账', '礼金', '随礼', '人情', '礼品', '花店']],
  ['salary',    ['工资', '薪资', '代发', '劳务', '报销']],
  ['bonus',     ['奖金', '年终奖', '绩效', '补贴', '津贴']],
  ['redpacket', ['红包', '压岁钱', '微信红包']],
  ['invest',    ['利息', '理财', '基金', '分红', '收益', '余额宝']],
  ['refund',    ['退款', '退货', '退回']],
];

/** "¥1,234.50" / "1234.5" -> 123450（分） */
export function toCents(str) {
  const n = Number(String(str).replace(/[^0-9.]/g, ''));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** 支持双引号包裹与转义的 CSV 行拆分 */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** UTF-8 / GBK 自动识别（微信导出一般是 UTF-8，支付宝多为 GBK） */
export function decodeBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let start = 0;
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) start = 3;
  const body = bytes.subarray(start);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch (e) {
    try { return new TextDecoder('gbk').decode(body); }
    catch (e2) { return decodeGBK(body); }
  }
}

const COLS = {
  date: ['交易时间', '时间'],
  flow: ['收/支', '收支'],
  merchant: ['交易对方', '对方'],
  desc: ['商品', '商品说明', '商品名称'],
  amount: ['金额(元)', '金额'],
  status: ['当前状态', '交易状态'],
  order: ['交易单号', '交易订单号'],
  method: ['支付方式', '收/付款方式'],
  kind: ['交易类型', '交易分类'],
};

/** 按关键词猜分类：返回分类 id */
export function guessCategory(type, text) {
  const t = String(text || '').toLowerCase();
  const allowed = type === 'income'
    ? ['salary', 'bonus', 'redpacket', 'invest', 'refund']
    : RULES.map((r) => r[0]).filter((id) => !['salary', 'bonus', 'redpacket', 'invest', 'refund'].includes(id));
  for (const [id, kws] of RULES) {
    if (!allowed.includes(id)) continue;
    if (kws.some((k) => t.includes(String(k).toLowerCase()))) return id;
  }
  if (type === 'income') return /退款|退货/.test(t) ? 'refund' : 'other_in';
  return 'other';
}

/**
 * 解析微信 / 支付宝导出的 CSV 账单文本。
 * @returns {{rows:Array, skipped:{status:number,parse:number}, source:'wechat'|'alipay', header:string[]}}
 */
export function parseBill(text) {
  const lines = String(text).split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('交易时间') && lines[i].includes('金额')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error('没找到表头（需要包含「交易时间」和「金额」列）');
  const header = splitCsvLine(lines[headerIdx]).map((s) => s.trim());
  const col = {};
  for (const key of Object.keys(COLS)) {
    let idx = -1;
    for (const cand of COLS[key]) {
      idx = header.findIndex((h) => h === cand || h.startsWith(cand));
      if (idx >= 0) break;
    }
    col[key] = idx;
  }
  if (col.date < 0 || col.amount < 0 || col.flow < 0) throw new Error('表头缺少关键列（交易时间 / 收/支 / 金额）');

  const isWechat = header.some((h) => h.includes('当前状态')) || header.some((h) => h === '商户单号');
  const source = isWechat ? 'wechat' : 'alipay';
  const rows = [];
  const skipped = { status: 0, parse: 0 };

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const cells = splitCsvLine(raw);
    if (cells.length < 4) { skipped.parse++; continue; }
    const get = (k) => (col[k] >= 0 && cells[col[k]] != null ? cells[col[k]].trim() : '');

    const status = get('status');
    if (/关闭|失败|已撤销|已全额退款/.test(status)) { skipped.status++; continue; }

    const flow = get('flow');
    let type = '';
    if (/支出|付款|转出/.test(flow)) type = 'expense';
    else if (/收入|收款|转入/.test(flow)) type = 'income';
    else { skipped.status++; continue; }

    const amount = toCents(get('amount'));
    if (!amount) { skipped.parse++; continue; }

    const dateRaw = get('date').replace(/\//g, '-');
    const m = dateRaw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) { skipped.parse++; continue; }
    const date = `${m[1]}-${m[2]}-${m[3]}`;

    const merchant = get('merchant');
    const desc = get('desc');
    const kind = get('kind');
    const note = [merchant, desc].filter(Boolean).join(' ').slice(0, 60);
    const order = get('order');
    const method = get('method');
    const category = guessCategory(type, `${merchant} ${desc} ${kind}`);
    const dedupe = order || `${date}|${amount}|${merchant}|${desc}`;

    rows.push({ date, amount, type, merchant, desc, note, order, method, category, source, dedupe });
  }
  return { rows, skipped, source, headerIdx, header };
}
