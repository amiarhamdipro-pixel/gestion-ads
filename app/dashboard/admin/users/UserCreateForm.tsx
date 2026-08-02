'use client'

import { useActionState, useEffect, useRef } from 'react'
import { createUser, type CreateUserState } from './actions'
import { accent, green, ink, line, muted, red, surface } from '../../format'

const initialState: CreateUserState = { status: 'idle' }

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  fontFamily: 'inherit',
  color: ink,
  background: surface,
  border: `1px solid ${line}`,
  borderRadius: 8,
  padding: '8px 10px',
  width: '100%',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: muted,
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
}

export default function UserCreateForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, formAction, isPending] = useActionState(createUser, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.status === 'success') formRef.current?.reset()
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}
    >
      <label style={labelStyle}>
        E-mail
        <input type="email" name="email" required disabled={isPending} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Mot de passe temporaire
        <input type="password" name="password" required minLength={6} autoComplete="new-password" disabled={isPending} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Rôle
        <select name="role" defaultValue="client" disabled={isPending} style={inputStyle}>
          <option value="client">Client</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <label style={labelStyle}>
        Client
        <select name="clientId" required defaultValue="" disabled={isPending} style={inputStyle}>
          <option value="" disabled>
            Choisir un client
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={isPending}
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: '#FFFFFF',
          background: accent,
          border: 0,
          borderRadius: 8,
          padding: '9px 16px',
          cursor: isPending ? 'default' : 'pointer',
          opacity: isPending ? 0.65 : 1,
          height: 'fit-content',
        }}
      >
        {isPending ? 'Création…' : 'Créer'}
      </button>
      {state.status === 'success' ? (
        <p style={{ gridColumn: '1 / -1', fontSize: 12.5, color: green, margin: 0 }}>Compte {state.email} créé.</p>
      ) : null}
      {state.status === 'error' ? (
        <p style={{ gridColumn: '1 / -1', fontSize: 12.5, color: red, margin: 0 }}>{state.message}</p>
      ) : null}
    </form>
  )
}
