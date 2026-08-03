import { useParams } from 'react-router'
import { FirstCaptureScreen } from './FirstCaptureScreen'
import { RetakeCaptureScreen } from './RetakeCaptureScreen'

/**
 * Routeur entre les deux flux de capture, qui ne partagent rien d autre que
 * `CameraDeniedNotice` : première photo d un point de vue, ou reprise d un point de
 * vue existant. Aucun état ni appel caméra ici — chaque flux gère le sien.
 */
export function CameraScreen() {
  const { id } = useParams<{ id: string }>()
  return id ? <RetakeCaptureScreen viewpointId={id} /> : <FirstCaptureScreen />
}
