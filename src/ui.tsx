import type { ReactNode } from 'react'
import { isLoaded, loadModel } from './ai/client'
import { MODELS, type ModelId } from './ai/models'

export interface Busy {
  label: string
  /** 0–1, or undefined for an indeterminate spinner */
  progress?: number
}

/** Loads models one by one, reporting download progress through setBusy. */
export async function ensureModels(models: ModelId[], setBusy: (b: Busy | null) => void) {
  for (const m of models) {
    if (isLoaded(m)) continue
    const mb = (n: number) => (n / 1e6).toFixed(1)
    setBusy({ label: `加载${MODELS[m].name}…`, progress: 0 })
    await loadModel(m, (loaded, total) =>
      setBusy(
        loaded >= total
          ? { label: `初始化${MODELS[m].name}…` }
          : { label: `下载${MODELS[m].name} ${mb(loaded)} / ${mb(total)} MB`, progress: loaded / total },
      ),
    )
  }
}

export function BusyOverlay({ busy }: { busy: Busy }) {
  return (
    <div className="busy">
      <div className="busy-card">
        <div className="busy-label">{busy.label}</div>
        <div className="bar">
          <div
            className={busy.progress === undefined ? 'bar-fill indeterminate' : 'bar-fill'}
            style={busy.progress === undefined ? undefined : { width: `${Math.round(busy.progress * 100)}%` }}
          />
        </div>
        <div className="busy-note">模型只需下载一次，之后会缓存在浏览器里；图片全程在本地处理，不会上传</div>
      </div>
    </div>
  )
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="group">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="label">{label}</span>
      <div className="control">{children}</div>
    </div>
  )
}

export function Segment<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T
  items: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div className="segment">
      {items.map(([v, label]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function Swatches({
  colors,
  value,
  onChange,
  transparent,
}: {
  colors: { name: string; color: string }[]
  value: string
  onChange: (v: string) => void
  /** adds a transparent option, represented by the value "transparent" */
  transparent?: boolean
}) {
  const known = colors.some((c) => c.color === value) || value === 'transparent'
  return (
    <div className="swatches wrap">
      {transparent && (
        <button
          title="透明"
          className={`swatch checker${value === 'transparent' ? ' on' : ''}`}
          onClick={() => onChange('transparent')}
        />
      )}
      {colors.map((c) => (
        <button
          key={c.color}
          title={c.name}
          className={`swatch${value === c.color ? ' on' : ''}`}
          style={{ background: c.color }}
          onClick={() => onChange(c.color)}
        />
      ))}
      <label className={`swatch picker${known ? '' : ' on'}`} title="自定义颜色">
        <input
          type="color"
          value={value.startsWith('#') ? value : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  )
}

export function DropZone({
  title,
  sub,
  onFiles,
  multiple,
}: {
  title: string
  sub: string
  onFiles: (files: File[]) => void
  multiple?: boolean
}) {
  return (
    <label className="dropzone">
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
      <strong>{title}</strong>
      <span>{sub}</span>
    </label>
  )
}
