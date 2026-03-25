import { useNavigate } from 'react-router-dom';
import AiCreativeLibraryTable from '../components/AiCreativeLibraryTable';
import { useData } from '../context/DataContext';

const AiRankingPage = () => {
  const navigate = useNavigate();
  const {
    dataLoading,
    aiCreativeLibraryNewItems,
    aiCreativeLibraryHotItems,
    aiCreativeLibrarySurgeItems,
  } = useData();

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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-1">AI 产品素材库</h1>
            <p className="text-sm text-slate-600">
              直接查看 `ai_products_ua.db` 的新上榜、热门、飙升三张最新素材榜单。
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center px-3 py-2 rounded-md border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 transition-colors"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7M3 12h18" />
            </svg>
            返回
          </button>
        </div>

        <AiCreativeLibraryTable
          newItems={aiCreativeLibraryNewItems}
          hotItems={aiCreativeLibraryHotItems}
          surgeItems={aiCreativeLibrarySurgeItems}
        />
      </div>
    </div>
  );
};

export default AiRankingPage;
