import { useCallback } from 'react';
import type { Location } from 'react-router-dom';
import { useLocation, useNavigate } from 'react-router-dom';

/** 与路由 state 中已有字段兼容 */
export type AppNavigationState = {
  returnTo?: string;
  casualSourceSection?: 'wechat_douyin' | 'sensortower';
  /** 从休闲游戏工作台返回时恢复侧栏竞品 / 我方产品等引导态 */
  casualHubTarget?: 'competitor' | 'our_product';
  from?: 'list';
};

export function currentPathForReturn(location: { pathname: string; search: string }): string {
  return `${location.pathname}${location.search || ''}`;
}

export function stateWithReturnTo(
  currentLocation: { pathname: string; search: string },
  extra?: Partial<AppNavigationState>
): AppNavigationState {
  return {
    returnTo: currentPathForReturn(currentLocation),
    ...extra,
  };
}

/** 从详情页跳到另一详情时：当前页作为 returnTo，并继承上一跳带来的休闲游戏恢复字段 */
export function buildForwardNavigationState(
  location: Pick<Location, 'pathname' | 'search' | 'state'>
): AppNavigationState {
  const out: AppNavigationState = {
    returnTo: currentPathForReturn(location),
  };
  const prev = location.state as AppNavigationState | null;
  if (prev?.casualSourceSection) out.casualSourceSection = prev.casualSourceSection;
  if (prev?.casualHubTarget) out.casualHubTarget = prev.casualHubTarget;
  return out;
}

function restoreStateForReturn(st: AppNavigationState): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = {};
  if (st.casualSourceSection) next.restoreCasualSourceSection = st.casualSourceSection;
  if (st.casualHubTarget) next.casualHubTarget = st.casualHubTarget;
  return Object.keys(next).length ? next : undefined;
}

/**
 * 智能返回：优先 state.returnTo，其次 history 后退，最后 fallback。
 */
export function useNavigateBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    const st = location.state as AppNavigationState | null;
    if (st?.returnTo) {
      const rs = restoreStateForReturn(st);
      if (rs) navigate(st.returnTo, { state: rs });
      else navigate(st.returnTo);
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }, [navigate, location.state, fallback]);
}

/**
 * 详情页等：在 returnTo 之后仍支持 Casual 子应用传入的 backTo + fromList。
 */
export function useSmartBack(options: {
  fallback: string;
  backTo?: string;
  fromList?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { fallback, backTo, fromList } = options;
  return useCallback(() => {
    const st = location.state as AppNavigationState | null;
    if (st?.returnTo) {
      const rs = restoreStateForReturn(st);
      if (rs) navigate(st.returnTo, { state: rs });
      else navigate(st.returnTo);
      return;
    }
    if (backTo !== undefined && fromList) {
      navigate(backTo);
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }, [navigate, location.state, fallback, backTo, fromList]);
}
