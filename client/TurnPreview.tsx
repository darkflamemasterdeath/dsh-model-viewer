import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  listTurnFiles,
  loadTurnFile,
  peekTurnFile,
  type TurnFileEntry,
} from './api'
import { Viewer } from './viewer/Viewer'

function turnNumber(turn: { turn: number } | number | undefined): number | undefined {
  if (typeof turn === 'number') return turn
  return turn?.turn
}

/** Format a byte count into a human-readable size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const card: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '14px 18px',
  borderRadius: 12,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
}

const cardIcon: CSSProperties = {
  flex: '0 0 auto',
  color: 'var(--dsw-alias-label-secondary)',
}

const cardText: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
}

const cardName: CSSProperties = {
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  font: '500 13px/20px inherit',
  color: 'var(--dsw-alias-label-primary)',
}

const cardSize: CSSProperties = {
  margin: 0,
  font: '12px/18px inherit',
  color: 'var(--dsw-alias-label-secondary)',
}

// Cartoon sticker-style button in doomsday colors: ember gradient, scorched border, hard offset shadow.
const cartoButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '8px 18px',
  border: '2px solid #5c3a22',
  borderRadius: 999,
  background: 'linear-gradient(160deg, #e8875a 0%, #a8542e 100%)',
  color: '#fff3e2',
  font: '700 13px/20px inherit',
  letterSpacing: 1,
  cursor: 'pointer',
  boxShadow: '0 4px 0 #5c3a22',
  transition: 'transform 0.12s ease, box-shadow 0.12s ease',
}

const cartoButtonBusy: CSSProperties = {
  ...cartoButton,
  opacity: 0.65,
  cursor: 'default',
}

// Small corner control over a loaded viewer: collapse it back to the load card.
const hideCorner: CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  zIndex: 2,
  padding: '5px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 999,
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-secondary)',
  font: '500 12px/18px inherit',
  cursor: 'pointer',
}

const animations = `
.dsh-cartoon-btn:hover:not(:disabled) {
  transform: translateY(-3px);
  box-shadow: 0 7px 0 #5c3a22;
}
.dsh-cartoon-btn:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #5c3a22;
}
`

interface PreviewItem {
  entry: TurnFileEntry
  file: File | null
  busy: boolean
  /** Previews added mid-session auto-load; history waits for the user to press the button. */
  auto: boolean
}

function PreviewCard(props: { entry: TurnFileEntry, busy: boolean, onLoad: () => void }) {
  return (
    <div style={card}>
      <style>{animations}</style>
      <svg style={cardIcon} width={28} height={28} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2.5l8.5 4.8v9.4L12 21.5 3.5 16.7V7.3z" />
        <path d="M12 2.5v19M3.5 7.3L12 12l8.5-4.7" />
      </svg>
      <div style={cardText}>
        <p style={cardName}>{props.entry.name}</p>
        <p style={cardSize}>{formatBytes(props.entry.bytes)}</p>
      </div>
      <button
        className="dsh-cartoon-btn"
        style={props.busy ? cartoButtonBusy : cartoButton}
        disabled={props.busy}
        onClick={props.onLoad}
      >
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'rgba(255, 243, 226, 0.72)',
        }}>
          <svg width={8} height={8} viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 1l7 4-7 4z" fill="currentColor" />
          </svg>
        </span>
        {props.busy ? '加载中…' : '加载预览'}
      </button>
    </div>
  )
}

/**
 * Models drawn under one reply. History shows only a card and button; download and render on click;
 * previews that appear mid-session auto-load.
 */
export function TurnPreview(props: { turn?: { turn: number, status?: string } | number, sessionId?: string }) {
  const turn = turnNumber(props.turn)
  const status = typeof props.turn === 'object' ? props.turn.status : undefined
  const sessionId = props.sessionId
  const [items, setItems] = useState<PreviewItem[]>([])
  const firstList = useRef(true)

  useEffect(() => {
    if (turn === undefined || sessionId === undefined) return undefined
    let cancelled = false
    void listTurnFiles(sessionId, turn).then(entries => {
      if (cancelled) return
      const isFirst = firstList.current
      firstList.current = false
      setItems(prev => {
        const prevByIndex = new Map(prev.map(item => [item.entry.index, item]))
        return entries.map(entry => {
          const existing = prevByIndex.get(entry.index)
          if (existing !== undefined) return existing
          const cached = peekTurnFile(sessionId, turn, entry.index)
          return {
            entry,
            file: cached ?? null,
            busy: false,
            auto: !isFirst && cached === undefined,
          }
        })
      })
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [sessionId, turn, status])

  // Auto-load: only entries added mid-session; one failure falls back to the button, no retry.
  useEffect(() => {
    for (const item of items) {
      if (!item.auto || item.file !== null || item.busy) continue
      if (sessionId === undefined || turn === undefined) return
      void loadTurnFile(sessionId, turn, item.entry).then(file => {
        setItems(prev => prev.map(cur => cur.entry.index === item.entry.index
          ? { ...cur, file, busy: false, auto: false }
          : cur))
      }, () => {
        setItems(prev => prev.map(cur => cur.entry.index === item.entry.index
          ? { ...cur, busy: false, auto: false }
          : cur))
      })
    }
  }, [items, sessionId, turn])

  function load(entry: TurnFileEntry): void {
    if (sessionId === undefined || turn === undefined) return
    setItems(prev => prev.map(cur => cur.entry.index === entry.index
      ? { ...cur, busy: true, auto: false }
      : cur))
    void loadTurnFile(sessionId, turn, entry).then(file => {
      setItems(prev => prev.map(cur => cur.entry.index === entry.index
        ? { ...cur, file, busy: false }
        : cur))
    }, () => {
      setItems(prev => prev.map(cur => cur.entry.index === entry.index
        ? { ...cur, busy: false }
        : cur))
    })
  }

  // Collapse a rendered preview back to its load card — not a permanent hide. Caches
  // stay warm so pressing load again re-renders instantly; auto stays off so the card
  // waits for the click instead of reloading on its own.
  function collapse(entry: TurnFileEntry): void {
    setItems(prev => prev.map(cur => cur.entry.index === entry.index
      ? { ...cur, file: null, auto: false }
      : cur))
  }

  if (items.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {items.map(item => item.file !== null
        ? (
          <div key={item.entry.index} style={{ position: 'relative' }}>
            <button style={hideCorner} onClick={() => collapse(item.entry)}>
              不再显示
            </button>
            <Viewer file={item.file} />
          </div>
        )
        : (
          <PreviewCard
            key={item.entry.index}
            entry={item.entry}
            busy={item.busy}
            onLoad={() => load(item.entry)}
          />
        ))}
    </div>
  )
}
