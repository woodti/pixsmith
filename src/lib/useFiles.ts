import { useEffect, useState, type DragEvent } from 'react'

/** Paste anywhere + drag-and-drop onto the returned props' element. */
export function useFiles(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) onFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onFiles])

  return {
    dragging,
    dropProps: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault()
        setDragging(true)
      },
      onDragLeave: () => setDragging(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setDragging(false)
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
        if (files.length) onFiles(files)
      },
    },
  }
}
