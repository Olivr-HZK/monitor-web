/**
 * 从 public 目录加载 report_documents.json（统一 ReportDocument 格式的 AI 日报）
 * 每一条转为 MonitorItem，type 为 ai热点检测，reportContent 为 JSON 字符串
 * @param getDataUrl 可选，后端鉴权时传入
 */

import type { MonitorItem, ReportDocument } from '../types';

export async function loadReportDocuments(getDataUrl?: (filename: string) => string): Promise<MonitorItem[]> {
  try {
    const url = getDataUrl ? getDataUrl('report_documents.json') : 'report_documents.json';
    const opts = url.startsWith('/api') ? { credentials: 'include' as RequestCredentials } : {};
    const response = await fetch(url, opts);
    if (!response.ok) {
      console.warn('report_documents.json not found or failed to load');
      return [];
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      console.warn('report_documents.json: expected array');
      return [];
    }
    return data
      .filter((doc: unknown): doc is ReportDocument => doc != null && typeof doc === 'object' && 'title' in doc && typeof (doc as ReportDocument).content === 'string')
      .map((doc: ReportDocument, index: number): MonitorItem => {
        const dateStr = doc.date ?? '';
        const dateParts = dateStr.split('-');
        const shortDate = dateParts.length >= 3 ? `${dateParts[1]}-${dateParts[2]}` : dateStr || '01-01';
        return {
          id: `report-doc-${index}-${(doc.date ?? '').replace(/-/g, '')}`,
          type: 'ai热点检测',
          title: doc.title,
          source: doc.source ?? 'AI日报',
          platform: doc.source === 'wechat' ? '微信公众号' : doc.source === 'xhs' ? '小红书' : 'AI日报',
          date: shortDate,
          time: doc.time ?? '00:00',
          views: 0,
          engagement: 0,
          description: doc.summary ?? doc.title,
          tags: doc.tags ?? [],
          language: '中文',
          score: doc.score,
          coverImage: doc.coverImage,
          reportContent: JSON.stringify(doc),
        };
      });
  } catch (error) {
    console.error('Error loading report_documents.json:', error);
    return [];
  }
}
