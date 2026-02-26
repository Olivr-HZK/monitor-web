import { createContext, useContext, useState } from 'react';
import type {
  MonitorType,
  CasualGameMainCategory,
  CasualGameCompetitorSub,
  GamePlatformKey,
  AiProductSubCategory,
} from '../types';

interface CasualViewState {
  selectedType: MonitorType;
  setSelectedType: (type: MonitorType) => void;
  selectedCompany: string | null;
  setSelectedCompany: (company: string | null) => void;
  selectedCasualGameCategory: CasualGameMainCategory | null;
  setSelectedCasualGameCategory: (cat: CasualGameMainCategory | null) => void;
  selectedGamePlatform: GamePlatformKey | null;
  setSelectedGamePlatform: (platform: GamePlatformKey | null) => void;
  selectedCasualGameCompetitorSub: CasualGameCompetitorSub | null;
  setSelectedCasualGameCompetitorSub: (sub: CasualGameCompetitorSub | null) => void;
  selectedCasualSourceSection: 'wechat_douyin' | 'sensortower';
  setSelectedCasualSourceSection: (section: 'wechat_douyin' | 'sensortower') => void;
  selectedAiProductSub: AiProductSubCategory;
  setSelectedAiProductSub: (sub: AiProductSubCategory) => void;
}

const CasualViewContext = createContext<CasualViewState | undefined>(undefined);

export const CasualViewProvider = ({ children }: { children: React.ReactNode }) => {
  const [selectedType, setSelectedType] = useState<MonitorType>('休闲游戏监测');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [selectedCasualGameCategory, setSelectedCasualGameCategory] =
    useState<CasualGameMainCategory | null>('周报简要');
  const [selectedGamePlatform, setSelectedGamePlatform] = useState<GamePlatformKey | null>('微信');
  const [selectedCasualGameCompetitorSub, setSelectedCasualGameCompetitorSub] =
    useState<CasualGameCompetitorSub | null>(null);
  const [selectedCasualSourceSection, setSelectedCasualSourceSection] =
    useState<'wechat_douyin' | 'sensortower'>('wechat_douyin');
  const [selectedAiProductSub, setSelectedAiProductSub] =
    useState<AiProductSubCategory>('UA素材');

  return (
    <CasualViewContext.Provider
      value={{
        selectedType,
        setSelectedType,
        selectedCompany,
        setSelectedCompany,
        selectedCasualGameCategory,
        setSelectedCasualGameCategory,
        selectedGamePlatform,
        setSelectedGamePlatform,
        selectedCasualGameCompetitorSub,
        setSelectedCasualGameCompetitorSub,
        selectedCasualSourceSection,
        setSelectedCasualSourceSection,
        selectedAiProductSub,
        setSelectedAiProductSub,
      }}
    >
      {children}
    </CasualViewContext.Provider>
  );
};

export const useCasualView = () => {
  const ctx = useContext(CasualViewContext);
  if (!ctx) {
    throw new Error('useCasualView must be used within CasualViewProvider');
  }
  return ctx;
};

