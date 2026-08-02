'use client'

import { useState } from 'react'
import { muted } from '@/app/dashboard/format'
import { EyeIcon, EyeOffIcon, LockIcon } from '@/app/dashboard/icons'
import { AuthErrorMessage, AuthStyles, AuthSubmitButton, authInputStyle, authLabelStyle } from '@/app/auth-ui'
import { updatePassword } from './actions'

const toggleButtonStyle: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: 0,
  background: 'transparent',
  padding: 0,
  color: muted,
  cursor: 'pointer',
}

export default function UpdatePasswordForm({ error }: { error: string | null }) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form action={updatePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <AuthStyles />

      {error ? <AuthErrorMessage>{error}</AuthErrorMessage> : null}

      <label style={authLabelStyle}>
        Nouveau mot de passe
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <LockIcon size={16} style={{ position: 'absolute', left: 12, color: muted, pointerEvents: 'none' }} />
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            required
            minLength={6}
            autoComplete="new-password"
            className="amerys-auth-input"
            placeholder="••••••••"
            style={{ ...authInputStyle, padding: '11px 40px 11px 38px' }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Masquer les mots de passe' : 'Afficher les mots de passe'}
            aria-pressed={showPassword}
            className="amerys-auth-toggle"
            style={toggleButtonStyle}
          >
            {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
          </button>
        </div>
      </label>

      <label style={authLabelStyle}>
        Confirmer le mot de passe
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <LockIcon size={16} style={{ position: 'absolute', left: 12, color: muted, pointerEvents: 'none' }} />
          <input
            type={showPassword ? 'text' : 'password'}
            name="confirmPassword"
            required
            minLength={6}
            autoComplete="new-password"
            className="amerys-auth-input"
            placeholder="••••••••"
            style={{ ...authInputStyle, padding: '11px 40px 11px 38px' }}
          />
        </div>
      </label>

      <AuthSubmitButton idleLabel="Mettre à jour" pendingLabel="Mise à jour…" />
    </form>
  )
}
