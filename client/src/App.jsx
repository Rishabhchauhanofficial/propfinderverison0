import { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';

import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import Protected from './components/Protected.jsx';
import CompareTray from './components/CompareTray.jsx';
import ChatWidget from './components/chat/ChatWidget.jsx';
import Loader from './components/Loader.jsx';
import { ErrorBoundary } from './components/ui.jsx';

import HomePage from './pages/HomePage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import PropertyDetailPage from './pages/PropertyDetailPage.jsx';
import AuthPage from './pages/AuthPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

// Heavier, less-visited pages are code-split.
const PostPropertyPage = lazy(() => import('./pages/PostPropertyPage.jsx'));
const EditPropertyPage = lazy(() => import('./pages/EditPropertyPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const LocalityPage = lazy(() => import('./pages/LocalityPage.jsx'));
const ComparePage = lazy(() => import('./pages/ComparePage.jsx'));
const SavedPage = lazy(() => import('./pages/SavedPage.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage.jsx').then((m) => ({ default: m.ProjectsPage })));
const ProjectDetailPage = lazy(() => import('./pages/ProjectsPage.jsx').then((m) => ({ default: m.ProjectDetailPage })));
const info = (name) => lazy(() => import('./pages/InfoPages.jsx').then((m) => ({ default: m[name] })));
const AssistantPage = info('AssistantPage');
const ForgotPasswordPage = info('ForgotPasswordPage');
const ResetPasswordPage = info('ResetPasswordPage');
const ContactPage = info('ContactPage');
const MethodologyPage = info('MethodologyPage');
const ReraInfoPage = info('ReraInfoPage');

// Reset scroll position on every route change (not on query-string changes).
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function PageTransition({ children }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}

const guard = (el, roles) => <Protected roles={roles}>{el}</Protected>;

export default function App() {
  return (
    <div className="app">
      <ScrollToTop />
      <Navbar />

      <main className="app__main" id="main">
        <ErrorBoundary>
          <Suspense fallback={<div className="container section"><Loader label="Loading…" /></div>}>
            <PageTransition>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/buy" element={<SearchPage mode="buy" />} />
                <Route path="/rent" element={<SearchPage mode="rent" />} />
                <Route path="/commercial" element={<SearchPage mode="commercial" />} />
                <Route path="/search" element={<SearchPage mode="all" />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:slug" element={<ProjectDetailPage />} />
                <Route path="/property/:id" element={<PropertyDetailPage />} />
                <Route path="/property/:id/edit" element={guard(<EditPropertyPage />)} />
                <Route path="/post" element={guard(<PostPropertyPage />)} />
                <Route path="/dashboard" element={guard(<DashboardPage />)} />
                <Route path="/admin" element={guard(<AdminPage />, ['admin'])} />
                <Route path="/saved" element={guard(<SavedPage />)} />
                <Route path="/profile" element={guard(<ProfilePage />)} />
                <Route path="/compare" element={<ComparePage />} />
                <Route path="/assistant" element={<AssistantPage />} />
                <Route path="/locality/:city/:locality" element={<LocalityPage />} />
                <Route path="/methodology" element={<MethodologyPage />} />
                <Route path="/rera" element={<ReraInfoPage />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/register" element={<AuthPage mode="register" />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </PageTransition>
          </Suspense>
        </ErrorBoundary>
      </main>

      <Footer />
      <CompareTray />
      <ChatWidget />
    </div>
  );
}
