import { useEffect, useRef, useState } from 'react'
import type { Map as LMap, Marker } from 'leaflet'

export interface Pin { id: string; name: string; lat: number; lng: number; locked?: boolean }

/**
 * A small OpenStreetMap (Leaflet, loaded only when a map is shown). Pins are plain dots. With `onPlace`, clicking the map
 * sets the pin (used on the location page). With `onPick`, clicking a pin chooses that location (overview).
 */
export default function LocationMap({ pins, selectedId, onPick, onPlace, height = 260, label }: {
  pins: Pin[]; selectedId?: string; onPick?: (id: string) => void; onPlace?: (lat: number, lng: number) => void; height?: number; label: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<LMap | null>(null)
  const markers = useRef<Marker[]>([])
  const lib = useRef<typeof import('leaflet') | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const cb = useRef({ onPick, onPlace }); cb.current = { onPick, onPlace }
  const fitted = useRef('')

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [L] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
        if (!live || !box.current) return
        lib.current = L
        const m = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([20, 0], 2)
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m)
        m.on('click', (e) => { cb.current.onPlace?.(Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6) })
        map.current = m
        setReady(true)
      } catch { if (live) setFailed(true) }
    })()
    return () => { live = false; map.current?.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const m = map.current, L = lib.current
    if (!ready || !m || !L) return
    markers.current.forEach((x) => x.remove()); markers.current = []
    for (const p of pins) {
      const icon = L.divIcon({ className: 'lb-pin-wrap', html: `<span class="lb-pin${p.id === selectedId ? ' is-on' : ''}${p.locked ? ' is-locked' : ''}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] })
      const mk = L.marker([p.lat, p.lng], { icon, title: p.name, keyboard: Boolean(onPick) }).addTo(m)
      if (onPick) mk.on('click', () => cb.current.onPick?.(p.id))
      markers.current.push(mk)
    }
    const key = pins.map((p) => `${p.id}:${p.lat}:${p.lng}`).join('|')
    if (key !== fitted.current) {
      fitted.current = key
      if (pins.length === 1) m.setView([pins[0].lat, pins[0].lng], 16)
      else if (pins.length > 1) m.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30], maxZoom: 15 })
    }
  }, [pins, selectedId, ready, onPick])

  if (failed) return <p className="lb-caption" role="status">The map could not load. Check your connection.</p>
  return <div ref={box} className="lb-map" style={{ height }} role="region" aria-label={label} />
}
