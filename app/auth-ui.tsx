'use client'

// Pièces partagées entre /login, /forgot-password et /update-password —
// un seul style de champ, de bouton et de message d'erreur pour les trois
// écrans d'authentification (même ton, même composants). Palette reprise de
// app/dashboard/format.ts, aucune couleur inventée.

import { useFormStatus } from 'react-dom'
import { accent, green, ink, line, muted, onDark, red, softBg, surface } from './dashboard/format'

export const authInputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 14,
  fontFamily: 'inherit',
  color: ink,
  background: surface,
  border: `1px solid ${line}`,
  borderRadius: 10,
  padding: '11px 12px 11px 38px',
}

export const authLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12.5,
  fontWeight: 600,
  color: muted,
}

export function AuthStyles() {
  return (
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
  )
}

export function AuthErrorMessage({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </p>
  )
}

export function AuthSuccessMessage({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      style={{
        fontSize: 13,
        color: green,
        background: softBg(green, 0.1),
        border: `1px solid ${softBg(green, 0.3)}`,
        borderRadius: 10,
        padding: '10px 12px',
        margin: 0,
      }}
    >
      {children}
    </p>
  )
}

export function AuthSubmitButton({ idleLabel, pendingLabel }: { idleLabel: string; pendingLabel: string }) {
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
      {pending ? pendingLabel : idleLabel}
    </button>
  )
}
