import { BrowserRouter, Route, Routes } from 'react-router'
import { AlignScreen } from './ui/AlignScreen'
import { CameraScreen } from './ui/CameraScreen'
import { ViewpointListScreen } from './ui/ViewpointListScreen'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ViewpointListScreen />} />
        <Route path="/capture" element={<CameraScreen />} />
        <Route path="/v/:id/capture" element={<CameraScreen />} />
        <Route path="/v/:id/align" element={<AlignScreen />} />
      </Routes>
    </BrowserRouter>
  )
}
