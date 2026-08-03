import { useEffect, useRef } from 'react'
import { drawShot, type Drawable } from '@/render/drawShot'
import type { Size, Transform } from '@/types'

/**
 * Rend une photo dans le cadre canonique. Le canvas est dimensionné en pixels du
 * cadre puis étiré en CSS : le rendu reste identique à l export, quelle que soit la
 * taille d affichage.
 */
export function ShotCanvas({
  source,
  transform,
  frame,
  shot,
  className,
  ...rest
}: {
  source: Drawable | null
  transform: Transform
  frame: Size
  shot: Size
  className?: string
} & React.HTMLAttributes<HTMLCanvasElement>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (source) drawShot(ctx, source, transform, frame, shot)
  }, [source, transform, frame, shot])

  return (
    <canvas
      ref={canvasRef}
      width={frame.width}
      height={frame.height}
      className={className}
      {...rest}
    />
  )
}
