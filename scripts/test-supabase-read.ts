// Script local, jetable : vérifie la connexion Supabase applicative en lecture
// seule, avant d'écrire la moindre synchro en base. Lit une seule ligne dans
// `clients` (slug "formation-barbier") via le client admin (lib/supabase/admin.ts).
// Aucune écriture, aucun secret affiché. Lance avec `npm run test:supabase-read`.

import { readFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'

const REQUIRED_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

function loadEnvFile(file: string): void {
  let content: string
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    return
  }

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!match) continue
    const key = match[1]
    if (process.env[key]) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function assertRequiredEnv(): void {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Variable(s) manquante(s) dans .env : ${missing.join(', ')}`)
  }
}

async function main(): Promise<void> {
  loadEnvFile('.env')
  loadEnvFile('.env.local')
  assertRequiredEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
  if (/\/rest\/v1\/?$/.test(url)) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL ne doit pas inclure "/rest/v1/" (valeur actuelle mal formée).`)
  }

  console.log('\n=== Test lecture Supabase — client "formation-barbier" ===')

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('clients').select('id, name, slug').eq('slug', 'formation-barbier')

  if (error) {
    throw new Error(`Échec lecture Supabase : ${error.message}`)
  }

  if (!data || data.length !== 1) {
    throw new Error(`Résultat inattendu : ${data?.length ?? 0} ligne(s) trouvée(s) pour slug "formation-barbier" (1 attendue).`)
  }

  const client = data[0]
  console.log('✅ Connexion Supabase réussie, une seule ligne trouvée :')
  console.log(`  id   : ${client.id}`)
  console.log(`  name : ${client.name}`)
  console.log(`  slug : ${client.slug}`)
  console.log('\nAucune écriture effectuée.')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
})
