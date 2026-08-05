import { BrowserRouter, Route, Routes } from 'react-router'
import { AlignScreen } from './ui/AlignScreen'
import { CameraScreen } from './ui/CameraScreen'
import { CompareScreen } from './ui/CompareScreen'
import { SettingsScreen } from './ui/SettingsScreen'
import { ViewpointDetailScreen } from './ui/ViewpointDetailScreen'
import { ViewpointListScreen } from './ui/ViewpointListScreen'
import { CaptureFlash } from './ui/components/CaptureFlash'

export default function App() {
  return (
    <BrowserRouter>
      {/* Hors des routes : la prise de vue navigue vers le calage dès la tape, et le
          flash doit survivre à cette navigation pour être vu. */}
      <CaptureFlash />
      <Routes>
        <Route path="/" element={<ViewpointListScreen />} />
        <Route path="/capture" element={<CameraScreen />} />
        <Route path="/v/:id/capture" element={<CameraScreen />} />
        <Route path="/v/:id/align" element={<AlignScreen />} />
        <Route path="/v/:id/compare" element={<CompareScreen />} />
        <Route path="/v/:id" element={<ViewpointDetailScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
      </Routes>
    </BrowserRouter>
  )
}
