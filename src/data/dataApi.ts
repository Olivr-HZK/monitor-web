/**
 * 受保护数据请求：统一走 /api/data，带 cookie 或 Bearer 鉴权（见 utils/api withApiAuth）
 */
import { withApiAuth } from '../utils/api';

const DATA_BASE = '/api/data';

export function getDataUrl(filename: string): string {
  return `${DATA_BASE}/${encodeURIComponent(filename)}`;
}

export async function fetchData(filename: string): Promise<Response> {
  return fetch(getDataUrl(filename), withApiAuth());
}
