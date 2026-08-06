'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { accent, green, muted, red } from './format'

type Props = {
  campaignId: string
  initialPublished: boolean
}

type SaveState = { status: 'idle' | 'saving' } | { status: 'error'; message: string }

// Texte exact confirmé (voir BRIEF-CLAUDE-CODE.md, règle métier officielle) :
// affiché avant toute publication, jamais avant une dépublication (qui ne
// verrouille ni ne déverrouille rien). window.confirm() plutôt qu'une
// modale dédiée : bloquant, natif, aucune dépendance ajoutée — la
// confirmation reste obligatoire (un Annuler interrompt intégralement
// l'action, aucun appel réseau n'est déclenché).
const PUBLISH_CONFIRM_MESSAGE =
  'Cette action rendra immédiatement cette campagne visible au client.\n\n' +
  'Elle verrouillera définitivement les données de cette campagne.\n\n' +
  'Elle ne pourra plus jamais être synchronisée automatiquement.\n\n' +
  'Confirmer ?'

export default function PublishToggle({ campaignId, initialPublished }: Props) {
  const router = useRouter()
  const [published, setPublished] = useState(initialPublished)
  const [state, setState] = useState<SaveState>({ status: 'idle' })

  const isSaving = state.status === 'saving'

  async function handleToggle() {
    if (isSaving) return
    const next = !published

    if (next && !window.confirm(PUBLISH_CONFIRM_MESSAGE)) return

    setState({ status: 'saving' })

    try {
      const response = await fetch('/api/admin/campaigns/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, published: next }),
      })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setState({ status: 'error', message: body?.error ?? "Échec de l'enregistrement." })
        return
      }

      setPublished(body.campaign.published)
      setState({ status: 'idle' })
      // sync_locked (badge "En préparation"/"Validée", rendu côté serveur)
      // peut avoir changé sans que ce composant le suive lui-même en état
      // local — rafraîchit les Server Components de la page pour qu'il
      // reflète immédiatement le nouveau verrouillage, sans rechargement
      // manuel.
      router.refresh()
    } catch {
      setState({ status: 'error', message: "Échec de l'enregistrement." })
    }
  }

  return (
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isSaving}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: published ? muted : '#FFFFFF',
          background: published ? 'transparent' : accent,
          border: published ? `1px solid ${muted}` : 0,
          borderRadius: 8,
          padding: '5px 11px',
          cursor: isSaving ? 'default' : 'pointer',
          opacity: isSaving ? 0.65 : 1,
        }}
      >
        {isSaving ? 'Enregistrement…' : published ? 'Dépublier' : 'Publier'}
      </button>
      <span role="status" style={{ fontSize: 11.5, color: published ? green : muted, fontWeight: 600 }}>
        {published ? 'Publiée (visible client)' : 'Brouillon (invisible client)'}
      </span>
      {state.status === 'error' ? (
        <span role="alert" style={{ fontSize: 12, color: red }}>
          {state.message}
        </span>
      ) : null}
    </div>
  )
}
