/**
 * Hand a blob to the browser as a file to save.
 *
 * Four surfaces download something (the revenue report and the invoice's three doors), and the
 * anchor dance below has two non-obvious rules that each cost a broken download when missed — so
 * it is written once here rather than copied per caller.
 */
export function saveBlob(blob: Blob, filename: string) {
  // The anchor has to be IN the document for a programmatic click to download in Firefox, and the
  // object URL has to outlive the click — revoking it synchronously can race the browser's own
  // fetch of the blob and produce an empty file.
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
