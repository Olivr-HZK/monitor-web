import { useEffect, useMemo } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import StoreInfoDetail from '../components/StoreInfoDetail';
import { useAiPageContext } from '../context/AiPageContext';
import { useData } from '../context/DataContext';
import { useSmartBack } from '../utils/navigation';

interface StoreDetailPageProps {
  /** 子项目内使用时传入：从列表点进时返回该路径，从其他详情内链点进仍用 history 后退 */
  backTo?: string;
}

const StoreDetailPage = ({ backTo }: StoreDetailPageProps) => {
  const location = useLocation();
  const { id } = useParams();
  const { dataLoading, sensorTowerStoreCards } = useData();
  const { setPageMeta } = useAiPageContext();

  const fromList = (location.state as { from?: string } | null)?.from === 'list';
  const handleBack = useSmartBack({
    fallback: '/type/休闲游戏监测',
    backTo,
    fromList,
  });

  const card = useMemo(() => {
    if (!id) return undefined;
    const decoded = decodeURIComponent(id);
    return sensorTowerStoreCards.find((entry) => entry.id === decoded);
  }, [id, sensorTowerStoreCards]);

  useEffect(() => {
    if (!id) return;
    if (!card) {
      setPageMeta({
        pageKind: 'store_detail',
        storeId: decodeURIComponent(id),
        pageTitle: '商店页变化详情',
      });
      return;
    }
    setPageMeta({
      pageKind: 'store_detail',
      storeId: card.id,
      pageTitle: card.gameName,
      monitorType: '休闲游戏监测',
    });
  }, [id, card, setPageMeta]);

  if (dataLoading && !card) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center">
        <div className="text-slate-500">加载中...</div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center gap-4">
        <div className="text-slate-600">未找到该应用</div>
        <button
          type="button"
          onClick={handleBack}
          className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
        >
          返回
        </button>
      </div>
    );
  }

  return <StoreInfoDetail card={card} onBack={handleBack} />;
};

export default StoreDetailPage;
