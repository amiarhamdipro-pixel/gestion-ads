import { login } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <main style={{ maxWidth: 360, margin: '4rem auto', fontFamily: 'sans-serif' }}>
      <h1>Connexion</h1>
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
      <form action={login} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          Email
          <input type="email" name="email" required autoComplete="email" style={{ width: '100%' }} />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            style={{ width: '100%' }}
          />
        </label>
        <button type="submit">Se connecter</button>
      </form>
    </main>
  )
}
