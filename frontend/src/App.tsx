import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RequireRole } from './components/layout/RequireRole';
import { NAV } from './config/nav';
import { HOME_OF, useAuth } from './lib/auth';
import Login from './pages/auth/Login';
import ManagerHome from './pages/manager/Home';
import OperatorHome from './pages/operator/Home';
import LabSetup from './pages/manager/setup/LabSetup';
import Masters from './pages/manager/setup/Masters';
import Users from './pages/manager/setup/Users';
import BatchDetail from './pages/production/BatchDetail';
import BatchList from './pages/production/BatchList';
import Losses from './pages/production/Losses';
import TrayLabels from './pages/production/TrayLabels';
import Trays from './pages/production/Trays';
import ComingSoon from './pages/shared/ComingSoon';
import NotFound from './pages/shared/NotFound';
import SupervisorHome from './pages/supervisor/Home';
import AssignWork from './pages/daily/AssignWork';
import Attendance from './pages/daily/Attendance';
import DailyWork from './pages/daily/DailyWork';
import VerifyEntries from './pages/daily/VerifyEntries';
import MyAttendance from './pages/operator/MyAttendance';
import MyOutput from './pages/operator/MyOutput';
import Scan from './pages/operator/Scan';
import MonthlyCosts from './pages/costs/MonthlyCosts';
import Orders from './pages/orders/Orders';
import StockMedia from './pages/stock/StockMedia';
import Alerts from './pages/results/Alerts';
import Audit from './pages/results/Audit';
import Forecast from './pages/results/Forecast';
import Monitoring from './pages/results/Monitoring';
import Report from './pages/results/Report';

/**
 * Every address in the app.
 * /m/... manager · /s/... supervisor (manager may open too) · /o/... operator (all roles may open).
 * Pages not built yet show the "Coming soon" placeholder. Each later zip replaces a placeholder with a real page.
 */
const BUILT: Record<string, ReactElement> = {
  '/m': <ManagerHome />,
  '/s': <SupervisorHome />,
  '/o': <OperatorHome />,
  // Phase 2: lab set-up
  '/m/setup/lab': <LabSetup />,
  '/m/setup/masters': <Masters />,
  '/m/setup/users': <Users />,
  // Phase 3: production and tracking
  '/m/batches': <BatchList />,
  '/m/batches/:id': <BatchDetail />,
  '/m/trays': <Trays />,
  '/m/contamination': <Losses />,
  '/s/batches': <BatchList />,
  '/s/batches/:id': <BatchDetail />,
  '/s/trays': <Trays />,
  '/s/losses': <Losses />,
  // Phase 4: daily work
  '/m/daily': <DailyWork />,
  '/s/attendance': <Attendance />,
  '/s/assign': <AssignWork />,
  '/s/verify': <VerifyEntries />,
  '/o/scan': <Scan />,
  '/o/loss': <Scan mode="loss" key="loss" />,
  '/o/output': <MyOutput />,
  '/o/attendance': <MyAttendance />,
  // Phase 5: stock and media, orders, monthly costs
  '/m/stock': <StockMedia />,
  '/s/media': <StockMedia />,
  '/m/orders': <Orders />,
  '/m/costs': <MonthlyCosts />,
  // Phase 6: results
  '/m/forecast': <Forecast />,
  '/m/monitoring': <Monitoring />,
  '/m/alerts': <Alerts />,
  '/m/reports': <Report />,
  '/m/audit': <Audit />,
  '/s/monitoring': <Monitoring />,
  '/s/alerts': <Alerts />,
  '/s/reports': <Report />,
  '/o/alerts': <Alerts />,
};

const placeholders = (prefix: string) =>
  [...NAV.MANAGER, ...NAV.SUPERVISOR, ...NAV.OPERATOR]
    .flatMap((s) => s.items)
    .filter((i) => i.path.startsWith(prefix + '/') && !BUILT[i.path])
    .map((i) => <Route key={i.path} path={i.path} element={<ComingSoon />} />);

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? HOME_OF[user.role] : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      {/* Printable label sheets open without the sidebar */}
      <Route path="/m/trays/labels" element={<RequireRole allow={['MANAGER']}><TrayLabels /></RequireRole>} />
      <Route path="/s/trays/labels" element={<RequireRole allow={['SUPERVISOR', 'MANAGER']}><TrayLabels /></RequireRole>} />

      <Route element={<RequireRole allow={['MANAGER']}><AppShell /></RequireRole>}>
        {Object.entries(BUILT).filter(([p]) => p === '/m' || p.startsWith('/m/')).map(([p, el]) => <Route key={p} path={p} element={el} />)}
        {placeholders('/m')}
      </Route>

      <Route element={<RequireRole allow={['SUPERVISOR', 'MANAGER']}><AppShell /></RequireRole>}>
        {Object.entries(BUILT).filter(([p]) => p === '/s' || p.startsWith('/s/')).map(([p, el]) => <Route key={p} path={p} element={el} />)}
        {placeholders('/s')}
      </Route>

      <Route element={<RequireRole allow={['OPERATOR', 'SUPERVISOR', 'MANAGER']}><AppShell /></RequireRole>}>
        {Object.entries(BUILT).filter(([p]) => p === '/o' || p.startsWith('/o/')).map(([p, el]) => <Route key={p} path={p} element={el} />)}
        {placeholders('/o')}
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
