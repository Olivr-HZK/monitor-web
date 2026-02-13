import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import StoreInfoDetail from '../components/StoreInfoDetail';
import { useData } from '../context/DataContext';

const StoreDetailPage = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { dataLoading, sensorTowerStoreCards } = useData();

  const card = useMemo(() => {
    if (!id) return undefined;
    const decoded = decodeURIComponent(id);
    return sensorTowerStoreCards.find((entry) => entry.id === decoded);
  }, [id, sensorTowerStoreCards]);

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
          onClick={() => navigate(-1)}
          className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
        >
          返回
        </button>
      </div>
    );
  }

  return <StoreInfoDetail card={card} onBack={() => navigate(-1)} />;
};

export default StoreDetailPage;
