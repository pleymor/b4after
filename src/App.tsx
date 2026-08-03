import { BrowserRouter, Route, Routes } from 'react-router'
import { CameraScreen } from './ui/CameraScreen'
import { ViewpointListScreen } from './ui/ViewpointListScreen'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ViewpointListScreen />} />
        <Route path="/capture" element={<CameraScreen />} />
      </Routes>
    </BrowserRouter>
  )
}
