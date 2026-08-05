import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getReleaseByTag } from '../store'
import { useSession } from '../SessionContext'
import { Spinner } from '../components/Loaders'
import Wordmark from '../components/Wordmark'
import type { ReleaseDetail } from '../types'

type Loaded =
  | { tag: string; state: 'found'; release: ReleaseDetail }
  | { tag: string; state: 'not-found' }

export default function ReleaseNotes() {
  const { tag } = useParams<{ tag: string }>()
  const { t } = useSession()
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!tag) return
    let live = true
    getReleaseByTag(tag).then((r) => {
      if (!live) return
      setLoaded(r.ok ? { tag, state: 'found', release: r.data } : { tag, state: 'not-found' })
    })
    return () => { live = false }
  }, [tag])

  // Guards against a stale response landing after the tag param has already changed.
  const mine = loaded && loaded.tag === tag ? loaded : null

  if (!mine) {
    return (
      <div className="w-full min-h-[50vh] flex items-center justify-center">
        <Spinner label={t('Loading…', '加载中…')} />
      </div>
    )
  }

  if (mine.state === 'not-found') {
    return (
      <div className="form-wrap text-center pt-8 pb-12">
        <div className="text-center mb-10">
          <h1><Wordmark className="h-8 mx-auto" /></h1>
        </div>
        <div className="bg-surface-raised border-[1.5px] border-rose-border rounded-2xl p-5 mb-8 w-full box-border text-left">
          <p className="text-rose-muted text-[14px] leading-[1.6] mt-1.5">
            {t("We couldn't find this release.", '未找到该更新记录。')}
          </p>
        </div>
        <Link to="/" className="text-oxblood text-[13px]">{t('Back home', '返回首页')}</Link>
      </div>
    )
  }

  const { release } = mine
  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="mb-2">
        <Wordmark className="h-7" />
      </div>
      <p className="text-[12px] text-rose-muted mb-6">
        {new Date(release.published_at).toLocaleDateString()}
      </p>
      <h1 className="text-2xl font-heading text-ink mb-6">{release.title}</h1>
      <div className="text-[15px] leading-[1.7] text-ink whitespace-pre-wrap">
        {release.summary}
      </div>
    </div>
  )
}
