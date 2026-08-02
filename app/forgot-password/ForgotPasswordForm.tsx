'use client'

import { muted } from '@/app/dashboard/format'
import { MailIcon } from '@/app/dashboard/icons'
import { AuthErrorMessage, AuthStyles, AuthSubmitButton, authInputStyle, authLabelStyle } from '@/app/auth-ui'
import { requestPasswordReset } from './actions'

export default function ForgotPasswordForm({ error }: { error: string | null }) {
  return (
    <form action={requestPasswordReset} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

      <AuthSubmitButton idleLabel="Envoyer le lien" pendingLabel="Envoi…" />
    </form>
  )
}
