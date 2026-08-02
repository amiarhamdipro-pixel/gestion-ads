'use client'

// Habillage visuel uniquement : <form action={login}> pointe vers la même
// Server Action que précédemment (actions.ts, non modifiée), mêmes champs
// (name="email"/"password"), même validation native (required), même
// message d'erreur (prop `error`, dérivée de searchParams comme avant), même
// redirection après connexion. useFormStatus() (react-dom, déjà présent,
// aucune dépendance ajoutée) donne l'état de chargement sans toucher à
// l'action ni ajouter d'état dupliqué.

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { login } from './actions'
import { accent, ink, line, muted, onDark, red, softBg, surface } from '@/app/dashboard/format'
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '@/app/dashboard/icons'

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 14,
  fontFamily: 'inherit',
  color: ink,
  background: surface,
  border: `1px solid ${line}`,
  borderRadius: 10,
  padding: '11px 12px 11px 38px',
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12.5,
  fontWeight: 600,
  color: muted,
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="amerys-auth-submit"
      style={{
        width: '100%',
        border: 0,
        borderRadius: 999,
        padding: '12px 20px',
        fontSize: 14,
        fontWeight: 700,
        fontFamily: 'inherit',
        color: onDark,
        background: accent,
        cursor: pending ? 'default' : 'pointer',
        opacity: pending ? 0.7 : 1,
        boxShadow: '0 10px 24px rgba(79, 70, 229, 0.35)',
        marginTop: 6,
      }}
    >
      {pending ? 'Connexion…' : 'Se connecter'}
    </button>
  )
}

export default function LoginForm({ error }: { error: string | null }) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form action={login} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`
        .amerys-auth-input:focus {
          outline: none;
          border-color: ${accent};
          box-shadow: 0 0 0 3px ${softBg(accent, 0.16)};
        }
        .amerys-auth-submit:hover:not(:disabled) {
          filter: brightness(1.06);
        }
        .amerys-auth-toggle:hover {
          color: ${ink};
        }
      `}</style>

      {error ? (
        <p
          role="alert"
          style={{
            fontSize: 13,
            color: red,
            background: softBg(red, 0.1),
            border: `1px solid ${softBg(red, 0.3)}`,
            borderRadius: 10,
            padding: '10px 12px',
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}

      <label style={labelStyle}>
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
            style={inputStyle}
          />
        </div>
      </label>

      <label style={labelStyle}>
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
            style={{ ...inputStyle, padding: '11px 40px 11px 38px' }}
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

      <SubmitButton />
    </form>
  )
}
