import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import WeeklyReportDetail from '../components/WeeklyReportDetail';
import { useData } from '../context/DataContext';

const ReportDetailPage = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { dataLoading, monitorItems, storeChangeItemMap } = useData();

  const item = useMemo(() => {
    if (!id) return undefined;
    const decoded = decodeURIComponent(id);
    return monitorItems.find((entry) => entry.id === decoded);
  }, [id, monitorItems]);

  if (dataLoading && !item) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center">
        <div className="text-slate-500">加载中...</div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center gap-4">
        <div className="text-slate-600">未找到该报告</div>
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

  return (
    <WeeklyReportDetail
      item={item}
      onBack={() => navigate(-1)}
      storeChangeItemMap={storeChangeItemMap}
      onOpenStoreChange={(changeItem) => navigate(`/report/${encodeURIComponent(changeItem.id)}`)}
      onNavigateToEntry={(entryId) => navigate(`/report/${encodeURIComponent(entryId)}`)}
    />
  );
};

export default ReportDetailPage;
