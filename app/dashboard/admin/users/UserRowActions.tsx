'use client'

// Actions par compte : réinitialiser le mot de passe, désactiver/réactiver,
// supprimer. Chacune revérifie le rôle admin côté serveur (actions.ts) —
// ceci n'est qu'un habillage. Un admin ne peut agir sur son propre compte
// (désactivation/suppression) : le bouton est simplement masqué.

import { useActionState } from 'react'
import { deleteUser, resetUserPassword, toggleUserBan, type UserActionState } from './actions'
import { faint, green, line, red } from '@/app/dashboard/format'

const initialState: UserActionState = { status: 'idle' }

const rowButtonStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  border: `1px solid ${line}`,
  background: 'transparent',
  borderRadius: 7,
  padding: '5px 9px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

export default function UserRowActions({
  userId,
  email,
  isBanned,
  isSelf,
}: {
  userId: string
  email: string
  isBanned: boolean
  isSelf: boolean
}) {
  const [resetState, resetAction, resetPending] = useActionState(resetUserPassword, initialState)
  const [banState, banAction, banPending] = useActionState(toggleUserBan, initialState)
  const [deleteState, deleteAction, deletePending] = useActionState(deleteUser, initialState)

  if (isSelf) {
    return (
      <span style={{ fontSize: 11.5, color: faint }} title="Actions indisponibles sur votre propre compte">
        —
      </span>
    )
  }

  const feedback = deleteState.status === 'error' ? deleteState : banState.status !== 'idle' ? banState : resetState

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <form action={resetAction}>
          <input type="hidden" name="email" value={email} />
          <button type="submit" disabled={resetPending} style={rowButtonStyle}>
            {resetPending ? '…' : 'Réinitialiser mdp'}
          </button>
        </form>

        <form action={banAction}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="banned" value={String(isBanned)} />
          <button type="submit" disabled={banPending} style={rowButtonStyle}>
            {banPending ? '…' : isBanned ? 'Réactiver' : 'Désactiver'}
          </button>
        </form>

        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (!window.confirm(`Supprimer définitivement le compte ${email} ? Cette action est irréversible.`)) {
              e.preventDefault()
            }
          }}
        >
          <input type="hidden" name="userId" value={userId} />
          <button type="submit" disabled={deletePending} style={{ ...rowButtonStyle, color: red, borderColor: red }}>
            {deletePending ? '…' : 'Supprimer'}
          </button>
        </form>
      </div>

      {feedback.status !== 'idle' ? (
        <p
          role={feedback.status === 'error' ? 'alert' : 'status'}
          style={{ fontSize: 11, color: feedback.status === 'error' ? red : green, margin: 0 }}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  )
}
