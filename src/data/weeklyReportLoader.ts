/**
 * 周报数据加载器
 * 从 SQLite 数据库加载竞品周报数据
 */

import type { MonitorItem } from '../types';
import { fetchInitForDataUrl } from '../utils/api';

export interface WeeklyReport {
  id: number;
  company_name: string;
  start_date: string;
  end_date: string;
  report_content: string;
  created_at: string;
}

export interface WeeklyReportContent {
  company: string;
  start_date: string;
  end_date: string;
  period: {
    start_date: string;
    end_date: string;
    days: number;
  };
  card: any;
}

interface WeeklyRemoveItem {
  gameName: string;
  platform?: string;
  note?: string;
}

function findColumnIndex(columns: string[], candidates: string[]): number {
  const lower = columns.map((c) => c.toLowerCase());
  for (const name of candidates) {
    const idx = lower.indexOf(name.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

function buildWeeklyKey(company: string, start: string, end: string): string {
  return `${company.trim()}||${start.trim()}||${end.trim()}`;
}

function injectWeeklyRemoveSection(
  content: WeeklyReportContent,
  removed: WeeklyRemoveItem[]
): WeeklyReportContent {
  if (!removed.length) return content;

  const card = content.card ?? {};
  const elements = Array.isArray(card.elements) ? [...card.elements] : [];

  const lines: string[] = [];
  lines.push('**上周榜单中疑似下架的游戏**');
  lines.push('');
  removed.forEach((item, idx) => {
    const parts: string[] = [];
    parts.push(`${idx + 1}. ${item.gameName || '（未命名游戏）'}`);
    const meta: string[] = [];
    if (item.platform) meta.push(`平台：${item.platform}`);
    if (item.note) meta.push(item.note);
    if (meta.length) {
      parts.push(`（${meta.join('，')}）`);
    }
    lines.push(parts.join(' '));
  });

  const sectionText = lines.join('\n');

  if (elements.length > 0) {
    elements.push({ tag: 'hr' });
  }
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: sectionText,
    },
  });

  return {
    ...content,
    card: {
      ...card,
      elements,
    },
  };
}

/**
 * 从数据库加载周报数据并转换为 MonitorItem
 * 每个公司每周一份周报（一个卡片）
 * @param dbUrl 可选，默认 'competitor_data.db'；后端鉴权时传 getDataUrl('competitor_data.db')
 */
export async function loadWeeklyReportsFromDatabase(dbUrl: string = 'competitor_data.db'): Promise<MonitorItem[]> {
  try {
    // 使用 sql.js 读取数据库
    // 动态导入 sql.js
    const sqlJsModule = await import('sql.js');
    const initSqlJs = sqlJsModule.default;
    
    // 初始化 SQL.js，从 CDN 加载 wasm 文件
    const SQL = await initSqlJs({
      locateFile: (file: string) => {
        // 从 CDN 加载 wasm 文件
        return `https://sql.js.org/dist/${file}`;
      }
    });

    // 获取数据库文件（支持 /api/data 鉴权）
    const response = await fetch(dbUrl, fetchInitForDataUrl(dbUrl));
    if (!response.ok) {
      throw new Error(`Failed to fetch database: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    const db = new SQL.Database(new Uint8Array(buffer));

    const removedByKey = new Map<string, WeeklyRemoveItem[]>();

    // 尝试读取 weekly_remove 表（若不存在则忽略）
    try {
      const check = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='weekly_remove'`
      );
      if (check.length > 0 && check[0].values.length > 0) {
        const res = db.exec(`SELECT * FROM weekly_remove`);
        if (res.length > 0 && res[0].values.length > 0) {
          const columns = res[0].columns;
          const rows = res[0].values;
          const idxCompany = findColumnIndex(columns, ['company_name', 'company']);
          const idxStart = findColumnIndex(columns, ['start_date', 'week_start', 'start']);
          const idxEnd = findColumnIndex(columns, ['end_date', 'week_end', 'end']);
          const idxGame = findColumnIndex(columns, ['game_name', 'app_name', 'title', 'product_name']);
          const idxPlatform = findColumnIndex(columns, ['platform', 'platform_name', 'channel']);
          const idxNote = findColumnIndex(columns, ['note', 'remark', 'reason', 'desc', 'description']);

          if (idxCompany !== -1 && idxStart !== -1 && idxEnd !== -1 && idxGame !== -1) {
            rows.forEach((row: any[]) => {
              const company = String(row[idxCompany] ?? '').trim();
              const start = String(row[idxStart] ?? '').trim();
              const end = String(row[idxEnd] ?? '').trim();
              const gameName = String(row[idxGame] ?? '').trim();
              if (!company || !start || !end || !gameName) return;
              const platform =
                idxPlatform !== -1 ? String(row[idxPlatform] ?? '').trim() || undefined : undefined;
              const note =
                idxNote !== -1 ? String(row[idxNote] ?? '').trim() || undefined : undefined;
              const key = buildWeeklyKey(company, start, end);
              const list = removedByKey.get(key) ?? [];
              list.push({ gameName, platform, note });
              removedByKey.set(key, list);
            });
          }
        }
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('weekly_remove 表查询失败，忽略该部分：', e);
      }
    }

    // 查询周报数据
    const result = db.exec(`
      SELECT 
        id,
        company_name,
        start_date,
        end_date,
        report_content,
        created_at
      FROM weekly_reports
      ORDER BY start_date DESC, company_name ASC
    `);

    if (result.length === 0) {
      return [];
    }

    const rows = result[0].values;
    const columns = result[0].columns;

    // 将查询结果转换为 WeeklyReport 对象
    const reports: WeeklyReport[] = rows.map((row: any[]) => {
      const report: any = {};
      columns.forEach((col: string, index: number) => {
        report[col] = row[index];
      });
      return report as WeeklyReport;
    });

    // 转换为 MonitorItem
    const monitorItems: MonitorItem[] = reports.map((report) => {
      let reportContent: WeeklyReportContent;
      try {
        reportContent = JSON.parse(report.report_content);
      } catch (e) {
        console.error('Failed to parse report content:', e);
        reportContent = {
          company: report.company_name,
          start_date: report.start_date,
          end_date: report.end_date,
          period: {
            start_date: report.start_date,
            end_date: report.end_date,
            days: 7,
          },
          card: {},
        };
      }

      const key = buildWeeklyKey(report.company_name, report.start_date, report.end_date);
      const removedItems = removedByKey.get(key) ?? [];
      if (removedItems.length > 0) {
        reportContent = injectWeeklyRemoveSection(reportContent, removedItems);
      }

      // 提取评分
      const score = extractScore(reportContent);

      // 格式化日期
      const startDate = new Date(report.start_date);
      const endDate = new Date(report.end_date);
      const dateStr = formatDate(startDate);
      const timeStr = formatTime(new Date(report.created_at));

      // 生成标题
      const title = `📊 ${report.company_name} 周报 (${formatDateRange(startDate, endDate)})`;

      // 生成描述（从报告内容中提取关键信息）
      const description = generateDescription(reportContent);

      // 基础标签：去掉“周报”和公司名本身
      const tags: string[] = ['竞品监控'];

      // 根据内容激活“玩法更新”和“线下活动”标签（直接在原始 JSON 文本中查找关键词）
      const raw = report.report_content || '';
      if (raw.includes('玩法更新')) {
        tags.push('玩法更新');
      }
      if (raw.includes('线下活动')) {
        tags.push('线下活动');
      }

      return {
        id: `weekly-report-${report.id}`,
        type: '竞品社媒监控',
        title,
        source: `${report.company_name} 周报`,
        platform: '周报',
        companyName: report.company_name,
        date: dateStr,
        time: timeStr,
        views: 0, // 周报没有浏览量
        engagement: 0, // 周报没有互动数
        description,
        tags,
        language: '中文',
        trend: 'stable',
        sentiment: 'neutral',
        url: '#',
        score, // 评分
        reportContent: JSON.stringify(reportContent), // 保存（可能包含疑似下架部分的）JSON 内容
      };
    });

    db.close();
    return monitorItems;
  } catch (error) {
    console.error('Error loading weekly reports from database:', error);
    // 如果 sql.js 未安装或加载失败，返回空数组
    return [];
  }
}

/**
 * 格式化日期为 MM-DD 格式
 */
function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

/**
 * 格式化时间为 HH:MM 格式
 */
function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * 格式化日期范围
 */
function formatDateRange(startDate: Date, endDate: Date): string {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  return `${start} ~ ${end}`;
}

/**
 * 从报告内容提取评分
 * 查找所有平台的可用性评分，计算平均分
 */
function extractScore(reportContent: WeeklyReportContent): number | undefined {
  if (!reportContent.card?.elements) {
    return undefined;
  }

  const scores: number[] = [];
  const elements = reportContent.card.elements;

  elements.forEach((element: any) => {
    // 在文本内容中查找评分
    if (element.text?.content) {
      const scoreMatch = element.text.content.match(/\*\*可用性评分\*\*:\s*([\d.]+)\s*⭐/);
      if (scoreMatch) {
        const score = parseFloat(scoreMatch[1]);
        if (!isNaN(score)) {
          scores.push(score);
        }
      }
    }

    // 在字段中查找评分
    if (element.fields && Array.isArray(element.fields)) {
      element.fields.forEach((field: any) => {
        if (field.text?.content) {
          const scoreMatch = field.text.content.match(/\*\*可用性评分\*\*:\s*([\d.]+)\s*⭐/);
          if (scoreMatch) {
            const score = parseFloat(scoreMatch[1]);
            if (!isNaN(score)) {
              scores.push(score);
            }
          }
        }
      });
    }
  });

  if (scores.length > 0) {
    // 返回平均分
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    return Math.round(average * 10) / 10; // 保留一位小数
  }

  return undefined;
}

/**
 * 从报告内容生成描述
 */
function generateDescription(reportContent: WeeklyReportContent): string {
  const { company, start_date, end_date } = reportContent;
  
  let description = `${company} 在 ${start_date} 至 ${end_date} 期间的社媒监控周报。`;
  
  // 尝试从 card 中提取更多信息
  if (reportContent.card && reportContent.card.elements) {
    const elements = reportContent.card.elements;
    const platformCount = elements.filter((el: any) => 
      el.fields && el.fields.some((f: any) => 
        f.text?.content && f.text.content.includes('可用性评分')
      )
    ).length;
    
    if (platformCount > 0) {
      description += ` 监控了 ${platformCount} 个平台的动态更新。`;
    }
  }
  
  return description;
}
