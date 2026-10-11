import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { SiteProvider } from './lib/site.jsx';
import SecurityLock from './lib/lock.jsx';
import { PreferencesProvider } from './lib/PreferencesProvider.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <SiteProvider>
            <AuthProvider>
              <PreferencesProvider>
                <SecurityLock>
                  <App />
                </SecurityLock>
              </PreferencesProvider>
            </AuthProvider>
          </SiteProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
