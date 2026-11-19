import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, RouterProvider, Link, useRouteError } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { ConfirmHost, Toaster } from './components/ui/overlay';
import { Button, EmptyState, Spinner } from './components/ui/primitives';
import { useSettings } from './store';
import { AlertOctagon, Compass } from 'lucide-react';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Generator = lazy(() => import('./pages/Generator'));
const Converter = lazy(() => import('./pages/Converter'));
const Studio = lazy(() => import('./pages/Studio'));
const Explainer = lazy(() => import('./pages/Explainer'));
const Compiler = lazy(() => import('./pages/Compiler'));
const Learning = lazy(() => import('./pages/Learning'));
const Repos = lazy(() => import('./pages/Repos'));
const RepoWorkspace = lazy(() => import('./pages/RepoWorkspace'));
const Workspace = lazy(() => import('./pages/Workspace'));
const History = lazy(() => import('./pages/History'));
const SettingsPage = lazy(() => import('./pages/Settings'));

const page = (el: React.ReactNode) => (
  <Suspense
    fallback={
      <div className="flex h-[60vh] items-center justify-center gap-2 text-sm text-muted">
        <Spinner /> Loading…
      </div>
    }
  >
    {el}
  </Suspense>
);

function RouteError() {
  const err = useRouteError() as Error | undefined;
  return <EmptyState icon={AlertOctagon} title="This page crashed" description={err?.message ?? 'An unexpected error occurred.'} action={<Button variant="primary" onClick={() => location.reload()}>Reload</Button>} />;
}
function NotFound() {
  return <EmptyState icon={Compass} title="Page not found" description="The page you are looking for does not exist." action={<Link to="/"><Button variant="primary">Back to dashboard</Button></Link>} />;
}

export const routes = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: page(<Dashboard />) },
      { path: 'generator', element: page(<Generator />) },
      { path: 'converter', element: page(<Converter />) },
      { path: 'studio', element: page(<Studio />) },
      { path: 'explainer', element: page(<Explainer />) },
      { path: 'compiler', element: page(<Compiler />) },
      { path: 'learning', element: page(<Learning />) },
      { path: 'repos', element: page(<Repos />) },
      { path: 'repos/:id/:section?', element: page(<RepoWorkspace />) },
      { path: 'workspace', element: page(<Workspace />) },
      { path: 'history', element: page(<History />) },
      { path: 'settings', element: page(<SettingsPage />) },
      { path: '*', element: <NotFound /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export function useThemeEffect() {
  const { theme, accent } = useSettings((s) => s.settings);
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const root = document.documentElement;
      root.classList.toggle('dark', dark);
      root.classList.toggle('light', !dark);
      root.dataset.accent = accent;
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [theme, accent]);
}

export default function App() {
  const load = useSettings((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  useThemeEffect();
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
      <ConfirmHost />
    </>
  );
}
