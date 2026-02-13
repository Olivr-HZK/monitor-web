import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import { AuthProvider } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <DataProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </DataProvider>
    </AuthProvider>
  </StrictMode>,
);
