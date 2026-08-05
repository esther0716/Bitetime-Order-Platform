// Renders a release's Claude-written summary — markdown-lite ("### heading" + "- bullet"
// lines only, see apps/backend/src/releases.ts's prompt) — as headed bullet lists. Shared by
// the public /releases/:tag page and the admin draft preview so both read identically.
//
// Falls back to a plain paragraph for summaries written before this format existed (no "### "
// anywhere) rather than mangling old prose into a headerless bullet block.
interface Block { heading: string | null; items: string[] }

function parseSummary(text: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('### ')) {
      current = { heading: line.slice(4).trim(), items: [] }
      blocks.push(current)
    } else if (line.startsWith('- ')) {
      if (!current) { current = { heading: null, items: [] }; blocks.push(current) }
      current.items.push(line.slice(2).trim())
    } else {
      if (!current) { current = { heading: null, items: [] }; blocks.push(current) }
      current.items.push(line)
    }
  }
  return blocks
}

export default function ReleaseSummary({ text }: { text: string }) {
  if (!text.includes('### ')) {
    return <p className="text-[15px] leading-[1.7] text-ink whitespace-pre-wrap">{text}</p>
  }

  const blocks = parseSummary(text)
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, i) => (
        <div key={i}>
          {block.heading && (
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-rose-muted mb-1.5">
              {block.heading}
            </h3>
          )}
          <ul className="list-disc pl-5 flex flex-col gap-1">
            {block.items.map((item, j) => (
              <li key={j} className="text-[15px] leading-[1.6] text-ink">{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
