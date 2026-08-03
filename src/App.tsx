import { BrowserRouter, Route, Routes } from 'react-router'
import { ViewpointListScreen } from './ui/ViewpointListScreen'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ViewpointListScreen />} />
      </Routes>
    </BrowserRouter>
  )
}
