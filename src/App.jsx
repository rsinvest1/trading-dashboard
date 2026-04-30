import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import PlaybookPage from './pages/PlaybookPage';
import StrategiesPage from './pages/StrategiesPage';
import CalendarPage from './pages/CalendarPage';
import TradeLogPage from './pages/TradeLogPage';
import JournalPage from './pages/JournalPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/"          element={<DashboardPage />} />
          <Route path="/playbook"   element={<PlaybookPage />} />
          <Route path="/strategies" element={<StrategiesPage />} />
          <Route path="/calendar"   element={<CalendarPage />} />
          <Route path="/trades"    element={<TradeLogPage />} />
          <Route path="/journal"   element={<JournalPage />} />
          <Route path="/settings"  element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
