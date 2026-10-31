import { convertFileSrc, invoke } from '@tauri-apps/api/core'

/** Running inside the Tauri desktop app (models are bundled, no browser downloads). */
export const desktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Where model files are served from: the bundled copy via the app's `models://` protocol, else the site's models/ dir. */
export function modelBase() {
  return desktop ? convertFileSrc('', 'models') : new URL('models/', document.baseURI).href
}

export const RELEASES = 'https://github.com/woodti/pixsmith/releases/latest'

/** Native "Save as" dialog; resolves false when cancelled. */
export async function saveFile(blob: Blob, name: string) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return invoke<boolean>('save_file', bytes, { headers: { 'x-name': encodeURIComponent(name) } })
}

/** Webviews ignore target=_blank, so hand external links to the system browser. */
export function openLinksExternally() {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="http"]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    invoke('plugin:opener|open_url', { url: a.href }).catch(() => {})
  })
}
