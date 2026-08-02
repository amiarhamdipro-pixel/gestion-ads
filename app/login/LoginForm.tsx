'use client'

// Habillage visuel uniquement : <form action={login}> pointe vers la même
// Server Action que précédemment (actions.ts, non modifiée), mêmes champs
// (name="email"/"password"), même validation native (required), même
// message d'erreur (prop `error`, dérivée de searchParams comme avant), même
// redirection après connexion. Champs/bouton/erreur mutualisés via
// app/auth-ui.tsx (même composants que /forgot-password et /update-password).

import Link from 'next/link'
import { useState } from 'react'
import { login } from './actions'
import { accent, muted } from '@/app/dashboard/format'
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '@/app/dashboard/icons'
import { AuthErrorMessage, AuthStyles, AuthSubmitButton, authInputStyle, authLabelStyle } from '@/app/auth-ui'

export default function LoginForm({ error }: { error: string | null }) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form action={login} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <AuthStyles />

      {error ? <AuthErrorMessage>{error}</AuthErrorMessage> : null}

      <label style={authLabelStyle}>
        E-mail
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <MailIcon size={16} style={{ position: 'absolute', left: 12, color: muted, pointerEvents: 'none' }} />
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="amerys-auth-input"
            placeholder="vous@exemple.com"
            style={authInputStyle}
          />
        </div>
      </label>

      <label style={authLabelStyle}>
        Mot de passe
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <LockIcon size={16} style={{ position: 'absolute', left: 12, color: muted, pointerEvents: 'none' }} />
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            required
            autoComplete="current-password"
            className="amerys-auth-input"
            placeholder="••••••••"
            style={{ ...authInputStyle, padding: '11px 40px 11px 38px' }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            aria-pressed={showPassword}
            className="amerys-auth-toggle"
            style={{
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
            }}
          >
            {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
          </button>
        </div>
      </label>

      <div style={{ textAlign: 'right', marginTop: -8 }}>
        <Link href="/forgot-password" style={{ fontSize: 12.5, fontWeight: 600, color: accent, textDecoration: 'none' }}>
          Mot de passe oublié ?
        </Link>
      </div>

      <AuthSubmitButton idleLabel="Se connecter" pendingLabel="Connexion…" />
    </form>
  )
}
