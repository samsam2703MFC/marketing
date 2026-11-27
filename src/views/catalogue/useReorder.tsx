import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

/**
 * Le glisser de l'étape 3 « Gamme par gamme » (27/11/2026, client : « je dois pouvoir adapter le sens en drag and drop ») :
 * UNE implémentation pour la colonne « Le catalogue », la bande « Le catalogue à ce stade », la mise en page finale et la
 * liste des catégories d'une gamme.
 *
 *  - Pointer Events (souris, doigt, stylet) : on prend l'élément par sa poignée ⋮⋮ (`grip`), une copie flottante suit le
 *    pointeur, l'élément laisse à sa future place un emplacement en pointillés (`is-ghost`) ; Échap annule.
 *  - Clavier : sur la poignée, ← ↑ avancent d'un cran, → ↓ reculent d'un cran.
 *  - Après le dépôt, l'ordre voulu reste affiché (`order`) jusqu'à la fin de l'enregistrement (`busy` repasse à faux) :
 *    le serveur renvoie ensuite les pages rangées, l'écran se recompose sans revenir en arrière entre-temps.
 *
 * Un « groupe » est une liste ordonnée (les gammes, les catégories d'un bloc…) ; ses éléments portent `item(group, k)`,
 * leur poignée `grip(...)`. `k` est l'indice dans la liste telle que la donnent les données (pas l'ordre affiché).
 */

type Axis = 'x' | 'y'
interface Active {
  group: string
  from: number
  over: number
}
interface Rect {
  k: number
  r: DOMRect
}

export interface Reorder {
  /** La liste dans l'ordre affiché (glisser en cours, ou ordre déposé en attente d'enregistrement), avec l'indice d'origine. */
  order: <T>(group: string, list: T[], idOf: (x: T) => string) => Array<{ x: T; k: number }>
  /** Les attributs d'un élément qu'on peut déplacer (sa boîte sert au calcul de la place, et de modèle à la copie). */
  item: (group: string, k: number, axis?: Axis) => { 'data-sort': string; 'data-sort-k': number; 'data-sort-axis': Axis }
  /** Déplace sans glisser (boutons ‹ ›) : même enregistrement, même ordre tenu. */
  move: (group: string, from: number, to: number) => void
  /** Vrai pour l'élément pris : il est dessiné en emplacement pointillé. */
  isGhost: (group: string, k: number) => boolean
  /** Les propriétés de la poignée ⋮⋮ (un bouton). */
  grip: (
    group: string,
    k: number,
    count: number,
    id: string,
    label: string,
  ) => {
    type: 'button'
    className: string
    'data-grip': string
    'aria-label': string
    'aria-disabled': boolean
    title: string
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void
    onClick: (e: { stopPropagation: () => void; preventDefault: () => void }) => void
  }
  /** Vrai pendant un glisser (n'importe quel groupe). */
  dragging: boolean
}

const THRESHOLD = 5

export function useReorder(onMove: (group: string, from: number, to: number) => void, opts: { busy: boolean }): Reorder {
  const [active, setActiveState] = useState<Active | null>(null)
  const activeRef = useRef<Active | null>(null)
  const setActive = (a: Active | null) => {
    activeRef.current = a
    setActiveState(a)
  }
  /** L'ordre déposé, par groupe, en attente de la réponse du serveur. */
  const [held, setHeld] = useState<Record<string, string[]>>({})
  const ids = useRef<Record<string, string[]>>({})
  const press = useRef<{ group: string; k: number; x: number; y: number; started: boolean; rects: Rect[]; el: HTMLElement | null; dx: number; dy: number; axis: Axis } | null>(null)
  const clone = useRef<HTMLElement | null>(null)
  const pendingFocus = useRef<{ key: string; until: number } | null>(null)
  const sawBusy = useRef(false)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  // L'ordre déposé tient jusqu'à la fin de l'enregistrement.
  useEffect(() => {
    if (opts.busy) sawBusy.current = true
    else if (sawBusy.current) {
      sawBusy.current = false
      setHeld({})
    }
  }, [opts.busy])
  useEffect(() => {
    if (!Object.keys(held).length) return
    const t = window.setTimeout(() => setHeld({}), 10000)
    return () => window.clearTimeout(t)
  }, [held])

  // Le focus clavier suit l'élément déplacé.
  useEffect(() => {
    const f = pendingFocus.current
    if (!f) return
    if (Date.now() > f.until) {
      pendingFocus.current = null
      return
    }
    const el = document.querySelector<HTMLElement>(`[data-grip="${CSS.escape(f.key)}"]`)
    if (el && document.activeElement !== el) el.focus()
  })

  const removeClone = () => {
    clone.current?.remove()
    clone.current = null
  }

  const commit = useCallback((group: string, from: number, to: number) => {
    const list = ids.current[group]
    if (!list || from === to || to < 0 || to >= list.length) return
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setHeld((h) => ({ ...h, [group]: next }))
    onMoveRef.current(group, from, to)
  }, [])

  const overOf = (rects: Rect[], from: number, x: number, y: number, axis: Axis): number => {
    let n = 0
    for (const { k, r } of rects) {
      if (k === from) continue
      const before = axis === 'y' ? y > r.top + r.height / 2 : y > r.bottom || (y >= r.top && x > r.left + r.width / 2)
      if (before) n++
    }
    return n
  }

  useEffect(() => {
    function move(e: PointerEvent) {
      const p = press.current
      if (!p) return
      if (!p.started) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return
        p.started = true
        if (p.el) {
          const r = p.el.getBoundingClientRect()
          p.dx = p.x - r.left
          p.dy = p.y - r.top
          const c = p.el.cloneNode(true) as HTMLElement
          c.classList.add('gp-float')
          c.removeAttribute('data-sort')
          c.querySelectorAll('[data-grip]').forEach((x) => x.removeAttribute('data-grip'))
          // La copie reste dans l'écran (`.gp`) : les règles de l'assistant (`.wz …`) et le texte hérité s'y appliquent.
          const cs = getComputedStyle(p.el)
          Object.assign(c.style, { fontSize: cs.fontSize, lineHeight: cs.lineHeight })
          Object.assign(c.style, { position: 'fixed', left: '0', top: '0', width: `${r.width}px`, margin: '0', pointerEvents: 'none', zIndex: '400' })
          ;(p.el.closest('.gp') ?? document.body).appendChild(c)
          clone.current = c
        }
        setActive({ group: p.group, from: p.k, over: p.k })
        document.body.classList.add('gp-dragging')
      }
      e.preventDefault()
      if (clone.current) clone.current.style.transform = `translate(${e.clientX - p.dx}px, ${e.clientY - p.dy}px)`
      const over = overOf(p.rects, p.k, e.clientX, e.clientY, p.axis)
      const a = activeRef.current
      if (a && a.over !== over) setActive({ ...a, over })
    }
    function end(cancel: boolean) {
      const p = press.current
      press.current = null
      removeClone()
      document.body.classList.remove('gp-dragging')
      const a = activeRef.current
      setActive(null)
      if (a && p?.started && !cancel && a.over !== a.from) commit(a.group, a.from, a.over)
    }
    const up = () => end(false)
    const cancel = () => end(true)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && press.current) end(true)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      removeClone()
      document.body.classList.remove('gp-dragging')
    }
  }, [commit])

  const order = <T,>(group: string, list: T[], idOf: (x: T) => string): Array<{ x: T; k: number }> => {
    const withK = list.map((x, k) => ({ x, k }))
    ids.current[group] = list.map(idOf)
    if (active && active.group === group && active.over !== active.from) {
      const out = [...withK]
      const [moved] = out.splice(active.from, 1)
      out.splice(active.over, 0, moved)
      return out
    }
    const h = held[group]
    if (h && h.length === list.length) {
      const pos = new Map(h.map((id, i) => [id, i]))
      if (list.every((x) => pos.has(idOf(x)))) return [...withK].sort((a, b) => (pos.get(idOf(a.x)) ?? 0) - (pos.get(idOf(b.x)) ?? 0))
    }
    return withK
  }

  return {
    order,
    item: (group, k, axis = 'x') => ({ 'data-sort': group, 'data-sort-k': k, 'data-sort-axis': axis }),
    move: commit,
    isGhost: (group, k) => !!active && active.group === group && active.from === k,
    dragging: active !== null,
    grip: (group, k, count, id, label) => ({
      type: 'button',
      className: 'gp-grip',
      'data-grip': `${group}:${id}`,
      'aria-label': `Déplacer « ${label} »`,
      'aria-disabled': opts.busy || count < 2,
      title: count < 2 ? label : `Glisser pour déplacer « ${label} » (au clavier : flèches)`,
      onClick: (e) => {
        e.stopPropagation()
        e.preventDefault()
      },
      onPointerDown: (e) => {
        if (opts.busy || count < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return
        e.stopPropagation()
        e.preventDefault()
        const el = (e.currentTarget.closest(`[data-sort="${CSS.escape(group)}"]`) as HTMLElement | null) ?? null
        const scope = el?.parentElement?.closest('[data-sort-scope]') ?? document
        const rects: Rect[] = [...scope.querySelectorAll<HTMLElement>(`[data-sort="${CSS.escape(group)}"]`)].map((x) => ({ k: Number(x.dataset.sortK), r: x.getBoundingClientRect() }))
        press.current = { group, k, x: e.clientX, y: e.clientY, started: false, rects, el, dx: 0, dy: 0, axis: el?.dataset.sortAxis === 'y' ? 'y' : 'x' }
      },
      onKeyDown: (e) => {
        const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown'
        if (!back && !fwd) return
        e.preventDefault()
        e.stopPropagation()
        if (opts.busy) return
        const to = k + (back ? -1 : 1)
        if (to < 0 || to >= count) return
        pendingFocus.current = { key: `${group}:${id}`, until: Date.now() + 4000 }
        commit(group, k, to)
      },
    }),
  }
}
