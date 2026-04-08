import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/** 供 AI 助手理解的页面语义（与路由、侧栏状态对齐） */
export type AiPageMeta = {
  pageTitle?: string;
  pageKind?: string;
  monitorType?: string;
  /** 休闲游戏侧栏主类 */
  casualGameCategory?: string;
  gamePlatform?: string;
  casualCompetitorSub?: string;
  casualSourceSection?: string;
  aiProductSub?: string;
  companyFilter?: string;
  rankingSection?: string;
  reportId?: string;
  storeId?: string;
  gameplaySource?: string;
  gameplayGameName?: string;
  [key: string]: string | undefined;
};

type AiPageContextValue = {
  pageMeta: AiPageMeta;
  setPageMeta: (meta: AiPageMeta) => void;
};

const AiPageContext = createContext<AiPageContextValue | undefined>(undefined);

export function AiPageProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [pageMeta, setPageMetaState] = useState<AiPageMeta>({});

  useEffect(() => {
    setPageMetaState({});
  }, [location.pathname]);

  const setPageMeta = useCallback((meta: AiPageMeta) => {
    setPageMetaState(meta);
  }, []);

  const value = useMemo(() => ({ pageMeta, setPageMeta }), [pageMeta, setPageMeta]);

  return <AiPageContext.Provider value={value}>{children}</AiPageContext.Provider>;
}

export function useAiPageContext(): AiPageContextValue {
  const ctx = useContext(AiPageContext);
  if (!ctx) {
    throw new Error('useAiPageContext must be used within AiPageProvider');
  }
  return ctx;
}
