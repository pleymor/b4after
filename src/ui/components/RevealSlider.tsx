import { useRef, useState, type ReactNode } from 'react'

/**
 * Deux calques superposés, le second découpé à la position de la poignée. Sert à
 * vérifier le calage avant d exporter : un décalage saute aux yeux au passage.
 */
export function RevealSlider({ before, after }: { before: ReactNode; after: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(0.5)

  function updateFrom(clientX: number) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    setPosition(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)))
  }

  return (
    <div
      ref={containerRef}
      data-testid="reveal-slider"
      className="relative h-full w-full touch-none overflow-hidden rounded-xl bg-black"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        updateFrom(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.buttons === 0) return
        updateFrom(event.clientX)
      }}
    >
      {before}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 0 0 ${position * 100}%)` }}
      >
        {after}
      </div>
      <div
        data-testid="reveal-handle"
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
        style={{ left: `${position * 100}%` }}
      />
    </div>
  )
}
