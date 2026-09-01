import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { STEPS } from './steps'

const PUBLIC = path.resolve(__dirname, '../../public')
const LANGS = ['en', 'zh'] as const

// Same argument as fonts.test.ts. Landing.tsx builds each `src` and `poster` by joining `file`,
// the showing language and an extension, so nothing links the array to the files on disk — a
// rename, a missed language or a file that never got committed degrades in near silence: the row
// keeps its reserved 960x720 box and shows nothing. This is the join.
//
// The POSTER is checked as hard as the clip, and is the more important of the two: it is what a
// reader sees under `prefers-reduced-motion`, with autoplay blocked, with JavaScript off, and in
// the prerendered markup a crawler reads. Lose it and the section is three empty rectangles for
// everyone the video never reaches.
describe('STEPS clips', () => {
  it('has one entry per step', () => {
    expect(STEPS.length).toBe(3)
  })

  it('ships a clip and its poster, in both languages, for every step', () => {
    for (const step of STEPS) {
      for (const lang of LANGS) {
        for (const ext of ['mp4', 'webp']) {
          const file = path.join(PUBLIC, 'images', 'steps', `${step.file}-${lang}.${ext}`)
          expect(existsSync(file), `missing ${path.relative(PUBLIC, file)}`).toBe(true)
        }
      }
    }
  })

  it('gives every entry a title, body and alt text in both languages', () => {
    for (const [i, step] of STEPS.entries()) {
      for (const field of ['title', 'body', 'alt'] as const) {
        expect(step[field].en.trim(), `step ${i} ${field}.en`).not.toBe('')
        expect(step[field].zh.trim(), `step ${i} ${field}.zh`).not.toBe('')
      }
    }
  })

  // Same check features.test.ts and faq.test.ts make: both fields are strings, so English sitting
  // in a Chinese slot type-checks perfectly and ships inside a Chinese page.
  it('gives every entry Chinese that actually contains Chinese', () => {
    for (const [i, step] of STEPS.entries()) {
      for (const field of ['title', 'body', 'alt'] as const) {
        expect(step[field].zh, `step ${i} ${field}`).toMatch(/[一-鿿]/)
      }
    }
  })

  it('keys every entry uniquely, so the list has stable keys', () => {
    expect(new Set(STEPS.map(s => s.n)).size).toBe(STEPS.length)
    expect(new Set(STEPS.map(s => s.file)).size).toBe(STEPS.length)
  })
})
