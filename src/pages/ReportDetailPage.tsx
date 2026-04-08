import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import WeeklyReportDetail from '../components/WeeklyReportDetail';
import { useAiPageContext } from '../context/AiPageContext';
import { useData } from '../context/DataContext';
import { buildForwardNavigationState, useSmartBack } from '../utils/navigation';

interface ReportDetailPageProps {
  /** 子项目内使用时传入：从列表点进时返回该路径，从周报内链点进仍用 history 后退 */
  backTo?: string;
}

const ReportDetailPage = ({ backTo }: ReportDetailPageProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const { dataLoading, monitorItems, storeChangeItemMap } = useData();
  const { setPageMeta } = useAiPageContext();

  const fromList = (location.state as { from?: string } | null)?.from === 'list';
  const handleBack = useSmartBack({ fallback: '/', backTo, fromList });

  const item = useMemo(() => {
    if (!id) return undefined;
    const decoded = decodeURIComponent(id);
    return monitorItems.find((entry) => entry.id === decoded);
  }, [id, monitorItems]);

  useEffect(() => {
    if (!id) return;
    if (!item) {
      setPageMeta({
        pageKind: 'report_detail',
        reportId: decodeURIComponent(id),
        pageTitle: '监测报告详情',
      });
      return;
    }
    setPageMeta({
      pageKind: 'report_detail',
      reportId: item.id,
      pageTitle: item.title,
      monitorType: item.type,
    });
  }, [id, item, setPageMeta]);

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
      onOpenStoreChange={(changeItem) =>
        navigate(`/report/${encodeURIComponent(changeItem.id)}`, {
          state: buildForwardNavigationState(location),
        })
      }
      onNavigateToEntry={(entryId) =>
        navigate(`/report/${encodeURIComponent(entryId)}`, {
          state: buildForwardNavigationState(location),
        })
      }
    />
  );
};

export default ReportDetailPage;
