import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './store/auth.jsx';
import { ToastProvider, Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Create from './pages/Create.jsx';
import Canvas from './pages/Canvas.jsx';
import Accounts from './pages/Accounts.jsx';
import Bind from './pages/Bind.jsx';

function Boot() {
  return <div className="grid h-full place-items-center bg-ink-900 text-brand-400"><Spinner size={26} /></div>;
}

function Guard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Boot />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/**
 * 只保留三个功能：快捷创作 / 无限画布 / muse 账号导入。
 * 其余页面（首页、论坛、价目表、会员、邀请、团队、API 平台、设置、历史）已下线，
 * 源码文件仍保留在 web/src/pages 下，需要时可重新接回路由。
 */
export default function App() {
  const { user, loading } = useAuth();

  return (
    <ToastProvider>
      <Routes>
        <Route
          path="/login"
          element={loading ? <Boot /> : user ? <Navigate to="/create" replace /> : <Login />}
        />
        <Route
          path="/bind/:code"
          element={
            <Guard>
              <Bind />
            </Guard>
          }
        />

        <Route
          element={
            <Guard>
              <Layout />
            </Guard>
          }
        >
          <Route path="/create" element={<Create />} />
          <Route path="/canvas" element={<Canvas />} />
          <Route path="/accounts" element={<Accounts />} />
        </Route>

        <Route path="*" element={<Navigate to={user ? '/create' : '/login'} replace />} />
      </Routes>
    </ToastProvider>
  );
}
