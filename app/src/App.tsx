import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { AuthProvider } from './lib/auth'
import { MAX_AGE, persistOptions } from './lib/offline'
import { Forgot, Join, Projects, RequireAuth, Reset, Settings, SignIn, SignUp } from './pages/Account'
import ProjectLayout from './components/ProjectLayout'
import Overview from './pages/Overview'
import Script from './pages/Script'
import ImportScript from './pages/ImportScript'
import ShotList from './pages/ShotList'
import Bible from './pages/Bible'
import Breakdown from './pages/Breakdown'
import CastCrew from './pages/CastCrew'
import Locations from './pages/Locations'
import SchedulePage from './pages/Schedule'
import { EquipmentPage, PropsPage } from './pages/Items'
import CallSheetsPage from './pages/CallSheets'
import Storyboard from './pages/Storyboard'
import TeamAccess from './pages/TeamAccess'
import { ExportSettings, SectionPage } from './pages/Sections'
import { Privacy, Terms } from './pages/Legal'
import Usage from './pages/Usage'

// gcTime matches the longest a saved offline copy is kept (lib/offline.ts), so a restored read is not thrown away at once.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true, gcTime: MAX_AGE } } })

export default function App() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/forgot" element={<Forgot />} />
            <Route path="/reset" element={<Reset />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/" element={<RequireAuth><Projects /></RequireAuth>} />
            <Route path="/join" element={<RequireAuth><Join /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
            <Route path="/usage" element={<RequireAuth><Usage /></RequireAuth>} />
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
              <Route path="locations" element={<Locations />} />
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
    </PersistQueryClientProvider>
  )
}
