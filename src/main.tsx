import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import { ToastProvider } from './components/ui.tsx';
import { Home } from './pages/Home.tsx';
import { CreateSession } from './pages/CreateSession.tsx';
import { SessionPage } from './pages/SessionPage.tsx';
import { Referee } from './pages/Referee.tsx';
import { LocalReferee } from './pages/LocalReferee.tsx';
import { TvBoard } from './pages/TvBoard.tsx';
import { Join } from './pages/Join.tsx';

// Aplikasi berhasil dimuat: reset penanda muat-ulang dan rapikan ?_r= dari URL (lihat index.html).
try {
  sessionStorage.removeItem('mwc.reloaded');
} catch {
  /* mode privat */
}
if (location.search.includes('_r=')) {
  const u = new URL(location.href);
  u.searchParams.delete('_r');
  history.replaceState(null, '', u.pathname + u.search + u.hash);
}

function NotFound() {
  return (
    <div className="app">
      <div className="card stack center" style={{ marginTop: 40 }}>
        <h2>Halaman tidak ditemukan</h2>
        <a className="btn btn-primary" href="/">
          Ke beranda
        </a>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/baru/:bookingId" element={<CreateSession />} />
          <Route path="/s/:slug" element={<SessionPage />} />
          <Route path="/s/:slug/wasit" element={<Referee />} />
          <Route path="/s/:slug/tv" element={<TvBoard />} />
          <Route path="/s/:slug/gabung" element={<Join />} />
          <Route path="/wasit-lokal" element={<LocalReferee />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
);
