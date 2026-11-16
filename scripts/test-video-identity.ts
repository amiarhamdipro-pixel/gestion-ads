// Tests de non-régression, purs (aucun réseau, aucune base) : regroupement
// des vidéos par nom normalisé dans la vue Comparaison (classement et
// recommandations). Lance avec `npx tsx scripts/test-video-identity.ts`.

import assert from 'node:assert/strict'
import { rankVideoRows, videoIdentityKey, type RankingAudienceRow, type RankingVideoRow } from '../app/dashboard/comparison/rankVideos'
import { buildVideoRecommendations } from '../app/dashboard/comparison/VideoRecommendations'

let failures = 0
function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`OK  ${name}`)
  } catch (error) {
    failures++
    console.log(`KO  ${name}\n    ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ── Jeu de données fictif ────────────────────────────────────────────────
const campaigns: { id: string; campaign_number: number; sync_locked: boolean }[] = []
const audiences: RankingAudienceRow[] = []
const videos: RankingVideoRow[] = []

function addAudience(n: number, type: 'barbier' | 'coiffeur', spend: number, leads: number, names: string[]): void {
  const campaignId = `c${n}`
  if (!campaigns.some((c) => c.id === campaignId)) campaigns.push({ id: campaignId, campaign_number: n, sync_locked: n <= 5 })
  const audienceId = `a${n}-${type}`
  audiences.push({ id: audienceId, campaign_id: campaignId, audience_type: type, meta_spend: spend, meta_pixel_leads: leads })
  for (const name of names) {
    videos.push({
      audience_id: audienceId,
      name: `Pub ${n} ${type}`,
      video_display_name: name,
      video_plays: 1000,
      video_plays_3s: 300,
      video_p100: 30,
      hook_rate_pct: null,
      retention_rate_pct: null,
    })
  }
}

const V5_A = 'video 5- yonn cut itw.mp4'
const V5_B = 'vidéo 5- yonn cut itw .mp4'
const V3_A = 'video 3 - vidéo ciseaux .mp4'
const V3_B = 'video 3 - video ciseaux.mp4'

// Vidéo 5 : 5 campagnes Barbier, 5 leads chacune (25), 50 € chacune (250 €).
// La campagne 5 porte les DEUX variantes dans la même audience : même vidéo,
// audience comptée une seule fois et non « partagée ».
addAudience(1, 'barbier', 50, 5, [V5_A])
addAudience(2, 'barbier', 50, 5, [V5_B])
addAudience(3, 'barbier', 50, 5, [V5_A])
addAudience(4, 'barbier', 50, 5, [V5_B])
addAudience(5, 'barbier', 50, 5, [V5_A, V5_B])
// Vidéo 3 : 5 campagnes Coiffeur, 4+4+4+3+3 = 18 leads, 36 € chacune (180 €).
addAudience(6, 'coiffeur', 36, 4, [V3_A])
addAudience(7, 'coiffeur', 36, 4, [V3_B])
addAudience(8, 'coiffeur', 36, 4, [V3_A])
addAudience(9, 'coiffeur', 36, 3, [V3_B])
addAudience(10, 'coiffeur', 36, 3, [V3_B])
// Deux vidéos réellement différentes, noms proches.
addAudience(11, 'barbier', 40, 2, ['video 1 - coupe.mp4'])
addAudience(12, 'barbier', 30, 3, ['video 2 - coupe.mp4'])

const ranked = rankVideoRows(audiences, videos, campaigns)
const find = (list: typeof ranked.all, key: string) => list.filter((v) => v.identityKey === videoIdentityKey(key))

// ── Clé normalisée ───────────────────────────────────────────────────────
test('reproduction : l ancienne clé (trim + minuscules) séparait les deux paires', () => {
  const oldKey = (s: string) => s.trim().toLowerCase()
  assert.notEqual(oldKey(V5_A), oldKey(V5_B))
  assert.notEqual(oldKey(V3_A), oldKey(V3_B))
})

test('clé : variantes de mise en forme fusionnées', () => {
  assert.equal(videoIdentityKey(V5_A), videoIdentityKey(V5_B))
  assert.equal(videoIdentityKey(V3_A), videoIdentityKey(V3_B))
  assert.equal(videoIdentityKey('  VIDÉO  5 -yonn cut itw.MP4 '), videoIdentityKey(V5_A))
  assert.equal(videoIdentityKey('video l’équipe – cut.mp4'), videoIdentityKey("video l'equipe - cut.mp4"))
})

test('clé : noms réellement différents jamais fusionnés', () => {
  const distinct = [
    'video 1 - coupe.mp4', 'video 2 - coupe.mp4', 'video 3.mp4', 'video 13.mp4',
    'video 1.2.mp4', 'video 12.mp4', 'video 3 - video ciseaux 2.mp4', 'video 3 - video ciseaux.mov',
    'video ab.mp4', 'video a b.mp4',
  ]
  assert.equal(new Set(distinct.map(videoIdentityKey)).size, distinct.length)
})

// ── Classement ───────────────────────────────────────────────────────────
test('video 5 : une seule vidéo, 5 campagnes, 25 leads, CPL 10 €', () => {
  const [v, ...rest] = find(ranked.all, V5_A)
  assert.equal(rest.length, 0)
  assert.equal(v.campaignCount, 5)
  assert.equal(v.totalLeads, 25)
  assert.equal(v.costPerLead, 10)
  assert.equal(v.cplNote, null)
  assert.equal(v.audienceType, 'barbier')
  // Égalité 3/3 entre les deux variantes -> départage alphabétique déterministe.
  assert.equal(v.displayName, [V5_A, V5_B].sort((a, b) => a.localeCompare(b))[0])
  assert.ok([V5_A, V5_B].includes(v.displayName), 'nom réel issu des données')
  assert.equal(v.occurrences.length, 5, 'détail : une ligne par audience')
})

test('video 3 : une seule vidéo, 5 campagnes, 18 leads, CPL 10 €', () => {
  const [v, ...rest] = find(ranked.all, V3_B)
  assert.equal(rest.length, 0)
  assert.equal(v.campaignCount, 5)
  assert.equal(v.totalLeads, 18)
  assert.equal(v.costPerLead, 10)
  assert.equal(v.displayName, V3_B, 'nom réel le plus fréquent conservé')
})

test('vidéos réellement différentes : deux groupes distincts', () => {
  assert.equal(find(ranked.all, 'video 1 - coupe.mp4').length, 1)
  assert.equal(find(ranked.all, 'video 2 - coupe.mp4').length, 1)
  assert.equal(ranked.all.length, 4)
  assert.equal(new Set(ranked.all.map((v) => v.identityKey)).size, 4)
})

test('vues filtrées cohérentes (même groupe, même nom, mêmes totaux)', () => {
  const [b] = find(ranked.barbier, V5_A)
  const [c] = find(ranked.coiffeur, V3_A)
  assert.equal(b.totalLeads, 25)
  assert.equal(b.displayName, find(ranked.all, V5_A)[0].displayName)
  assert.equal(c.totalLeads, 18)
  assert.equal(c.displayName, V3_B)
  assert.equal(ranked.barbier.length, 3)
  assert.equal(ranked.coiffeur.length, 1)
})

test('nom affiché indépendant de l ordre de lecture', () => {
  const reversed = rankVideoRows([...audiences].reverse(), [...videos].reverse(), [...campaigns].reverse())
  const names = (l: typeof ranked.all) => l.map((v) => `${v.identityKey}=${v.displayName}`).sort()
  assert.deepEqual(names(reversed.all), names(ranked.all))
})

test('audience avec deux vidéos réellement différentes : toujours non comparable', () => {
  const r = rankVideoRows(
    [{ id: 'x', campaign_id: 'c1', audience_type: 'barbier', meta_spend: 50, meta_pixel_leads: 5 }],
    [
      { ...videos[0], audience_id: 'x', video_display_name: 'video 1 - coupe.mp4' },
      { ...videos[0], audience_id: 'x', video_display_name: 'video 2 - coupe.mp4' },
    ],
    [campaigns[0]]
  )
  assert.equal(r.all.length, 2)
  assert.ok(r.all.every((v) => v.cplNote === 'shared_audience' && v.totalLeads === null))
})

// ── Noms Meta corrompus : "╠ü" = U+0301 (UTF-8 CC 81) relu en CP437 ─────
const META_YONN_BAD = 'vide╠üo 5- yonn cut itw .mp4'
const META_YONN_OK = 'video 5- yonn cut itw.mp4'
const META_CIS_BAD = 'video 3 - vide╠üo ciseaux .mp4'
const META_CIS_OK = 'video 3 - video ciseaux.mp4'

// Répartitions observées en production avant correction :
// Yonn 3 campagnes / 21 leads + 2 campagnes / 4 leads ;
// Ciseaux 1 campagne / 6 leads + 4 campagnes / 12 leads.
function metaFixture(extra: [number, 'barbier' | 'coiffeur', number, string][] = []) {
  const rows: [number, 'barbier' | 'coiffeur', number, string][] = [
    [1, 'barbier', 7, META_YONN_OK], [2, 'barbier', 7, META_YONN_OK], [3, 'barbier', 7, META_YONN_OK],
    [4, 'barbier', 2, META_YONN_BAD], [5, 'barbier', 2, META_YONN_BAD],
    [6, 'coiffeur', 6, META_CIS_OK],
    [7, 'coiffeur', 3, META_CIS_BAD], [8, 'coiffeur', 3, META_CIS_BAD], [9, 'coiffeur', 3, META_CIS_BAD], [10, 'coiffeur', 3, META_CIS_BAD],
    [11, 'barbier', 4, 'video 1 - coupe.mp4'], [12, 'barbier', 5, 'video 2 - coupe.mp4'],
    ...extra,
  ]
  return rankVideoRows(
    rows.map(([n, type, leads]) => ({ id: `m${n}`, campaign_id: `mc${n}`, audience_type: type, meta_spend: leads * 10, meta_pixel_leads: leads })),
    rows.map(([n, , , name]) => ({ ...videos[0], audience_id: `m${n}`, video_display_name: name })),
    rows.map(([n]) => ({ id: `mc${n}`, campaign_number: 100 + n, sync_locked: false }))
  )
}

test('noms Meta corrompus : les deux variantes donnent la même clé', () => {
  assert.equal(videoIdentityKey(META_YONN_BAD), videoIdentityKey(META_YONN_OK))
  assert.equal(videoIdentityKey(META_CIS_BAD), videoIdentityKey(META_CIS_OK))
  assert.equal(videoIdentityKey(META_YONN_BAD), 'video 5-yonn cut itw.mp4')
})

test('noms Meta corrompus : Yonn 5 campagnes / 25 leads, Ciseaux 5 campagnes / 18 leads', () => {
  const r = metaFixture()
  const [yonn, ...y2] = r.all.filter((v) => v.identityKey === videoIdentityKey(META_YONN_OK))
  const [cis, ...c2] = r.all.filter((v) => v.identityKey === videoIdentityKey(META_CIS_OK))
  assert.equal(y2.length + c2.length, 0)
  assert.equal(yonn.campaignCount, 5)
  assert.equal(yonn.totalLeads, 25)
  assert.equal(yonn.costPerLead, 10)
  assert.equal(yonn.displayName, META_YONN_OK, 'variante majoritaire (3 contre 2)')
  assert.equal(cis.campaignCount, 5)
  assert.equal(cis.totalLeads, 18)
  assert.equal(cis.costPerLead, 10)
  assert.equal(r.all.length, 4, 'les deux vidéos témoins restent séparées')
})

test('noms Meta corrompus : une future campagne réutilisant le nom est regroupée', () => {
  const r = metaFixture([[13, 'barbier', 5, META_YONN_BAD], [14, 'coiffeur', 2, META_CIS_OK]])
  const [yonn] = r.all.filter((v) => v.identityKey === videoIdentityKey(META_YONN_OK))
  const [cis] = r.all.filter((v) => v.identityKey === videoIdentityKey(META_CIS_OK))
  assert.equal(r.all.length, 4)
  assert.equal(yonn.campaignCount, 6)
  assert.equal(yonn.totalLeads, 30)
  assert.equal(cis.campaignCount, 6)
  assert.equal(cis.totalLeads, 20)
})

test('noms Meta corrompus : correction ciblée, aucune fusion abusive', () => {
  // Seule la séquence complète "╠ü" est rétablie ; chaque caractère isolé reste significatif.
  assert.notEqual(videoIdentityKey('video ╠ 5.mp4'), videoIdentityKey('video 5.mp4'))
  assert.notEqual(videoIdentityKey('vide╠o 5.mp4'), videoIdentityKey('video 5.mp4'))
  assert.notEqual(videoIdentityKey('vide╠üo 5- yonn cut itw .mp4'), videoIdentityKey('vide╠üo 6- yonn cut itw .mp4'))
  assert.notEqual(videoIdentityKey('video 3 - vide╠üo ciseaux .mp4'), videoIdentityKey('video 3 - vide╠üo ciseaux 2.mp4'))
  assert.notEqual(videoIdentityKey('video 3 - vide╠üo ciseaux .mp4'), videoIdentityKey('video 3 - vide╠üo ciseaux .mov'))
})

// ── Recommandations ──────────────────────────────────────────────────────
test('recommandations : calculées sur les groupes fusionnés', () => {
  const locked = new Set(campaigns.filter((c) => c.sync_locked).map((c) => c.campaign_number))
  const reco = buildVideoRecommendations(ranked, locked)
  assert.equal(reco.barbier.status, 'recommended')
  if (reco.barbier.status === 'recommended') {
    assert.equal(reco.barbier.video.identityKey, videoIdentityKey(V5_A))
    assert.equal(reco.barbier.video.totalLeads, 25)
    assert.equal(reco.barbier.confidence, 'confirmed', '25 leads sur 5 campagnes')
    assert.equal(reco.barbier.historical, 'all')
  }
  assert.equal(reco.coiffeur.status, 'recommended')
  if (reco.coiffeur.status === 'recommended') {
    assert.equal(reco.coiffeur.video.identityKey, videoIdentityKey(V3_A))
    assert.equal(reco.coiffeur.video.totalLeads, 18)
    assert.equal(reco.coiffeur.confidence, 'to_confirm', '18 leads < 20')
    assert.equal(reco.coiffeur.historical, null)
  }
})

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent')
process.exitCode = failures ? 1 : 0
