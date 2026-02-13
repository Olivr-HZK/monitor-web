import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Login from '../components/Login';
import CasualHomePage from './CasualHomePage';
import CasualRankingPage from '../pages/CasualRankingPage';
import ReportDetailPage from '../pages/ReportDetailPage';
import StoreDetailPage from '../pages/StoreDetailPage';

function CasualApp() {
  const { authMode, user, loading: authLoading, staticPasswordRequired } = useAuth();

  if (authMode === 'backend' && authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">验证登录中…</p>
      </div>
    );
  }

  if ((authMode === 'backend' && !user) || (staticPasswordRequired && !user)) {
    return <Login />;
  }

  return (
    <Routes>
      <Route path="/" element={<CasualHomePage />} />
      <Route path="/rankings/casual/:section" element={<CasualRankingPage />} />
      <Route path="/report/:id" element={<ReportDetailPage />} />
      <Route path="/store/:id" element={<StoreDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default CasualApp;

