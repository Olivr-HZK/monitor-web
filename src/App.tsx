import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './components/Login';
import HomePage from './pages/HomePage';
import MonitorTypePage from './pages/MonitorTypePage';
import CasualRankingPage from './pages/CasualRankingPage';
import AiRankingPage from './pages/AiRankingPage';
import ReportDetailPage from './pages/ReportDetailPage';
import StoreDetailPage from './pages/StoreDetailPage';
import GameplayDetailPage from './pages/GameplayDetailPage';

function App() {
  const { authMode, user, loading: authLoading, staticPasswordRequired } = useAuth();

  // 后端模式：验证登录中
  if (authMode === 'backend' && authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">验证登录中…</p>
      </div>
    );
  }
  // 未登录时显示登录页：后端模式 或 静态模式但配置了访问密码
  if ((authMode === 'backend' && !user) || (staticPasswordRequired && !user)) {
    return <Login />;
  }
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/type/:monitorType" element={<MonitorTypePage />} />
      <Route path="/rankings/ai" element={<AiRankingPage />} />
      <Route path="/rankings/casual/:section" element={<CasualRankingPage />} />
      <Route path="/report/:id" element={<ReportDetailPage />} />
      <Route path="/store/:id" element={<StoreDetailPage />} />
      <Route path="/gameplay/:source/:gameName" element={<GameplayDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
