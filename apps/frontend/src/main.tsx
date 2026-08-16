import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import AppRouter from './AppRouter'
import ErrorBoundary from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {/* Measurement is not mounted here. It is route-aware and must report nothing on a shop's
          storefront, so it lives inside the router as PlatformAnalytics — see AppRouter.tsx and
          analytics/scope.ts. */}
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
