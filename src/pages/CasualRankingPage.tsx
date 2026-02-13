import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import GameRankingView from '../components/GameRankingView';
import SensorTowerTopTable from '../components/SensorTowerTopTable';
import { useData } from '../context/DataContext';

const CasualRankingPage = () => {
  const navigate = useNavigate();
  const { section } = useParams();
  const { dataLoading, wechatDouyinRankings, sensorTowerTopItems, sensorTowerRankChangeItems, sensorTowerStoreChanges } = useData();

  const normalized = section === 'wechat_douyin' || section === 'sensortower' ? section : null;

  useEffect(() => {
    if (!normalized) {
      navigate('/type/休闲游戏监测', { replace: true });
    }
  }, [normalized, navigate]);

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
            onBack={() => navigate(-1)}
            onGameNameClick={(name) => navigate(`/gameplay/wechat_douyin/${encodeURIComponent(name)}`)}
          />
        ) : (
          <SensorTowerTopTable
            items={sensorTowerTopItems}
            rankChangeItems={sensorTowerRankChangeItems}
            storeChanges={sensorTowerStoreChanges}
            onBack={() => navigate(-1)}
          />
        )}
      </div>
    </div>
  );
};

export default CasualRankingPage;
