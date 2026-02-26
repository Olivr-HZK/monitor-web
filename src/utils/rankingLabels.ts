/**
 * 排行榜/日报 Top100 展示用：国家缩写→中文、榜单类型→中文（免费/付费）
 */

/** 常见国家/地区代码（大写）→ 中文名 */
const COUNTRY_CODE_TO_ZH: Record<string, string> = {
  US: '美国',
  GB: '英国',
  UK: '英国',
  CN: '中国',
  JP: '日本',
  KR: '韩国',
  DE: '德国',
  FR: '法国',
  CA: '加拿大',
  AU: '澳大利亚',
  IN: '印度',
  BR: '巴西',
  RU: '俄罗斯',
  IT: '意大利',
  ES: '西班牙',
  MX: '墨西哥',
  ID: '印度尼西亚',
  NL: '荷兰',
  TR: '土耳其',
  SA: '沙特阿拉伯',
  TW: '中国台湾',
  HK: '中国香港',
  SG: '新加坡',
  MY: '马来西亚',
  TH: '泰国',
  PH: '菲律宾',
  VN: '越南',
  PL: '波兰',
  SE: '瑞典',
  CH: '瑞士',
  AT: '奥地利',
  BE: '比利时',
  PT: '葡萄牙',
  AR: '阿根廷',
  CO: '哥伦比亚',
  ZA: '南非',
  EG: '埃及',
  AE: '阿联酋',
  IL: '以色列',
  GR: '希腊',
  CZ: '捷克',
  RO: '罗马尼亚',
  HU: '匈牙利',
  FI: '芬兰',
  NO: '挪威',
  DK: '丹麦',
  IE: '爱尔兰',
  NZ: '新西兰',
  CL: '智利',
  PE: '秘鲁',
};

/** 中文名 → SensorTower 国家代码（与 scripts/send_minigame_weekly_reports.py 中 COUNTRY_TO_CODE 一致） */
const COUNTRY_ZH_TO_CODE: Record<string, string> = {
  美国: 'US',
  日本: 'JP',
  英国: 'GB',
  德国: 'DE',
  印度: 'IN',
  中国: 'CN',
  法国: 'FR',
  韩国: 'KR',
  巴西: 'BR',
  加拿大: 'CA',
  澳大利亚: 'AU',
  俄罗斯: 'RU',
  墨西哥: 'MX',
  印尼: 'ID',
  土耳其: 'TR',
  意大利: 'IT',
  西班牙: 'ES',
};

/**
 * 从 rank_changes.country（如 🇺🇸 美国）或 Top100 country 解析出 SensorTower 国家代码
 */
export function countryToSensorTowerCode(country: string | undefined | null): string {
  if (country == null || country === '') return 'US';
  const s = String(country).trim();
  const upper = s.toUpperCase();
  if (upper.length <= 3 && /^[A-Z]{2,3}$/.test(upper)) return upper;
  for (const [zh, code] of Object.entries(COUNTRY_ZH_TO_CODE)) {
    if (s.includes(zh)) return code;
  }
  return 'US';
}

const SENSORTOWER_OVERVIEW_BASE = 'https://app.sensortower-china.com';

/**
 * 拼 SensorTower 应用概览页 URL（与企微周报脚本 _sensortower_overview_url 一致）
 */
export function buildSensorTowerOverviewUrl(appId: string | undefined | null, country: string | undefined | null): string {
  if (!appId || !String(appId).trim()) return '';
  const base = SENSORTOWER_OVERVIEW_BASE.replace(/\/$/, '');
  const code = countryToSensorTowerCode(country);
  return `${base}/overview/${String(appId).trim()}?country=${code}`;
}

/**
 * 将国家代码（如 US、GB）转为中文名；已是中文或未知则原样返回
 */
export function formatCountryToZh(code: string | undefined | null): string {
  if (code == null || code === '') return '';
  const upper = code.trim().toUpperCase();
  if (COUNTRY_CODE_TO_ZH[upper]) return COUNTRY_CODE_TO_ZH[upper];
  // 已是中文（含常见字符或长度较长）则原样返回
  if (/[\u4e00-\u9fa5]/.test(code) || code.length > 4) return code;
  return code;
}

/** 榜单类型英文 → 展示用中文 */
const CHART_TYPE_TO_ZH: Record<string, string> = {
  free: '免费榜',
  paid: '付费榜',
  grossing: '付费榜',
  Free: '免费榜',
  Paid: '付费榜',
  Grossing: '付费榜',
  FREE: '免费榜',
  PAID: '付费榜',
  GROSSING: '付费榜',
  'free games': '免费榜',
  'paid games': '付费榜',
  'Free Games': '免费榜',
  'Paid Games': '付费榜',
  'top grossing': '付费榜',
  'Top Grossing': '付费榜',
  'TOP GROSSING': '付费榜',
  'top grossing games': '付费榜',
  'Top Grossing Games': '付费榜',
  'TOP GROSSING GAMES': '付费榜',
};

/**
 * 将榜单类型（如 free、paid）转为中文「免费榜」「付费榜」；已是中文则原样返回
 */
export function formatChartTypeToZh(type: string | undefined | null): string {
  if (type == null || type === '') return '';
  const trimmed = type.trim();
  const key = trimmed.toLowerCase();
  // 精确映射优先
  if (CHART_TYPE_TO_ZH[trimmed]) return CHART_TYPE_TO_ZH[trimmed];
  // 只要字段中「包含」 free / grossing，也按免费榜 / 付费榜处理
  if (key.includes('free')) return '免费榜';
  if (key.includes('grossing') || key.includes('paid')) return '付费榜';
  // 已是中文
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed;
  return trimmed;
}
