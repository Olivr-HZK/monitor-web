import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import GameRankingView from '../components/GameRankingView';
import SensorTowerTopTable from '../components/SensorTowerTopTable';
import { useAiPageContext } from '../context/AiPageContext';
import { useData } from '../context/DataContext';
import { stateWithReturnTo, useNavigateBack } from '../utils/navigation';

const CasualRankingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useNavigateBack('/type/休闲游戏监测');
  const { setPageMeta } = useAiPageContext();
  const { section } = useParams();
  const { dataLoading, wechatDouyinRankings, sensorTowerTopItems, sensorTowerRankChangeItems } = useData();

  const normalized = section === 'wechat_douyin' || section === 'sensortower' ? section : null;

  useEffect(() => {
    if (!normalized) {
      navigate('/type/休闲游戏监测', { replace: true });
    }
  }, [normalized, navigate]);

  useEffect(() => {
    if (!normalized) return;
    setPageMeta({
      pageKind: 'casual_rankings',
      monitorType: '休闲游戏监测',
      pageTitle: normalized === 'wechat_douyin' ? '微信/抖音小游戏排行榜' : 'SensorTower Top100 榜单',
      rankingSection: normalized,
    });
  }, [normalized, setPageMeta]);

  if (!normalized) return null;

  if (dataLoading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center">
        <div className="text-slate-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 px-4 sm:px-6 lg:px-8 py-10">
      <div className="mx-auto w-full max-w-7xl">
        {normalized === 'wechat_douyin' ? (
          <GameRankingView
            rankings={wechatDouyinRankings}
            onBack={goBack}
            onGameNameClick={(name) =>
              navigate(`/gameplay/wechat_douyin/${encodeURIComponent(name)}`, {
                state: stateWithReturnTo(location),
              })
            }
          />
        ) : (
          <SensorTowerTopTable
            items={sensorTowerTopItems}
            rankChangeItems={sensorTowerRankChangeItems}
            onBack={goBack}
          />
        )}
      </div>
    </div>
  );
};

export default CasualRankingPage;
