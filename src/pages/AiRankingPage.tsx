import { useNavigate } from 'react-router-dom';
import GameRankingView from '../components/GameRankingView';
import { useData } from '../context/DataContext';

const AiRankingPage = () => {
  const navigate = useNavigate();
  const { dataLoading, aiProductRankings } = useData();

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
        <GameRankingView rankings={aiProductRankings} onBack={() => navigate(-1)} />
      </div>
    </div>
  );
};

export default AiRankingPage;
