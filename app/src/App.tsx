import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './lib/auth'
import { Forgot, Join, Projects, RequireAuth, Reset, Settings, SignIn, SignUp } from './pages/Account'
import ProjectLayout from './components/ProjectLayout'
import Overview from './pages/Overview'
import Script from './pages/Script'
import ImportScript from './pages/ImportScript'
import ShotList from './pages/ShotList'
import Bible from './pages/Bible'
import Breakdown from './pages/Breakdown'
import CastCrew from './pages/CastCrew'
import SchedulePage from './pages/Schedule'
import { EquipmentPage, PropsPage } from './pages/Items'
import CallSheetsPage from './pages/CallSheets'
import Storyboard from './pages/Storyboard'
import TeamAccess from './pages/TeamAccess'
import { ExportSettings, SectionPage } from './pages/Sections'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } } })

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/forgot" element={<Forgot />} />
            <Route path="/reset" element={<Reset />} />
            <Route path="/" element={<RequireAuth><Projects /></RequireAuth>} />
            <Route path="/join" element={<RequireAuth><Join /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
            <Route path="/p/:pid" element={<RequireAuth><ProjectLayout /></RequireAuth>}>
              <Route index element={<Overview />} />
              <Route path="script" element={<Script />} />
              <Route path="script/import" element={<ImportScript />} />
              <Route path="scenes" element={<Navigate to="../script" replace />} />
              <Route path="shots" element={<ShotList />} />
              <Route path="storyboard" element={<Storyboard />} />
              <Route path="bible" element={<Bible />} />
              <Route path="breakdown" element={<Breakdown />} />
              <Route path="cast" element={<CastCrew />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="props" element={<PropsPage />} />
              <Route path="equipment" element={<EquipmentPage />} />
              <Route path="callsheets" element={<CallSheetsPage />} />
              <Route path="team" element={<TeamAccess />} />
              <Route path="export" element={<ExportSettings />} />
              <Route path=":section" element={<SectionPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
