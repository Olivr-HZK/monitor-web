import { useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import WeeklyReportDetail from '../components/WeeklyReportDetail';
import { useData } from '../context/DataContext';

interface ReportDetailPageProps {
  /** 子项目内使用时传入：从列表点进时返回该路径，从周报内链点进仍用 history 后退 */
  backTo?: string;
}

const ReportDetailPage = ({ backTo }: ReportDetailPageProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const { dataLoading, monitorItems, storeChangeItemMap } = useData();

  const fromList = (location.state as { from?: string } | null)?.from === 'list';
  const handleBack = () => {
    if (backTo !== undefined && fromList) {
      navigate(backTo);
    } else {
      navigate(-1);
    }
  };

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
          onClick={handleBack}
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
      onBack={handleBack}
      storeChangeItemMap={storeChangeItemMap}
      onOpenStoreChange={(changeItem) => navigate(`/report/${encodeURIComponent(changeItem.id)}`)}
      onNavigateToEntry={(entryId) => navigate(`/report/${encodeURIComponent(entryId)}`)}
    />
  );
};

export default ReportDetailPage;
