import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Lecture des fichiers de marque (public/brand/, voir app/brand.ts) en data
// URI pour les images générées par next/og (Satori ne charge pas d'URL
// relative). Serveur uniquement (node:fs) : ne jamais importer depuis un
// composant client.
// Chemins LITTÉRAUX (jamais construits à partir d'une variable) : l'analyse
// statique de Next.js n'embarque alors que ces deux fichiers dans le bundle
// serveur, et non le projet entier.

export function brandIconDataUri(): string {
  return `data:image/png;base64,${readFileSync(join(process.cwd(), 'public', 'brand', 'amerys-icone.png')).toString('base64')}`
}

export function brandFaviconDataUri(): string {
  return `data:image/png;base64,${readFileSync(join(process.cwd(), 'public', 'brand', 'favicon-64.png')).toString('base64')}`
}
