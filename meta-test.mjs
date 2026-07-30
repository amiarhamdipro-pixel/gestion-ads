#!/usr/bin/env node
/**
 * ───────────────────────────────────────────────────────────────────────────
 * PHASE 0 — Script de test Meta (jetable)   ·   Amerys · Dashboard campagnes
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Lit ses identifiants dans un fichier .env (aucune variable à taper dans le
 * terminal), affiche le résultat à l'écran ET l'écrit dans « resultat-meta.txt ».
 *
 * ── 1. Crée un fichier « .env » À CÔTÉ de ce script, avec dedans : ───────────
 *      META_ACCESS_TOKEN=EAA...        (ton token, généré au Graph API Explorer)
 *      META_AD_ACCOUNT_ID=act_1490284429391038
 *      META_API_VERSION=v26.0
 *      # Étape 2 seulement (une fois l'id de la campagne maître connu) :
 *      # META_CAMPAIGN_ID=120xxxxxxxxxxxxxx
 *      # CAMPAIGN_NUMBER=20
 *      # LEAD_ACTION_TYPE=offsite_conversion.custom.123456789
 *
 * ── 2. Lance :  node meta-test.mjs
 * ── 3. Ouvre « resultat-meta.txt » qui apparaît dans le dossier.
 *
 * Étape 1 (sans META_CAMPAIGN_ID)  → liste toutes les campagnes du compte.
 * Étape 2 (avec META_CAMPAIGN_ID)  → détaille les ad sets + vidéos d'un numéro.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync } from 'node:fs';

// ── charge le .env (parseur minimal, sans dépendance) ───────────────────────
function loadEnv(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      if (process.env[key]) continue;               // ne pas écraser l'existant
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[key] = v;
    }
  } catch { /* pas de fichier .env : on ignore */ }
}
loadEnv('.env');
loadEnv('.env.local');

// ── sortie « tee » : on garde tout pour l'écrire aussi dans un fichier ──────
const lines = [];
const log = (...a) => { const s = a.join(' '); lines.push(s); console.log(s); };
const flush = () => { try { writeFileSync('resultat-meta.txt', lines.join('\n') + '\n'); } catch {} };

// ── config ──────────────────────────────────────────────────────────────────
const API_VERSION = process.env.META_API_VERSION || 'v23.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

const TOKEN       = (process.env.META_ACCESS_TOKEN || '').trim();
let   ACCOUNT     = (process.env.META_AD_ACCOUNT_ID || '').trim();
if (ACCOUNT && !ACCOUNT.startsWith('act_')) ACCOUNT = 'act_' + ACCOUNT.replace(/^act_?/, '');
const CAMPAIGN_ID = (process.env.META_CAMPAIGN_ID || '').trim();
const NUMBER      = (process.env.CAMPAIGN_NUMBER || '').trim();
const DATE_PRESET = process.env.DATE_PRESET || 'maximum';
const LEAD_ACTION = (process.env.LEAD_ACTION_TYPE || '').trim();

// ── utilitaires API ─────────────────────────────────────────────────────────
async function api(path, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Meta API — ${json.error.message} (code ${json.error.code})`);
  return json;
}
async function apiAll(path, params = {}) {
  const out = [];
  let json = await api(path, params);
  out.push(...(json.data || []));
  while (json.paging?.next) {
    const res = await fetch(json.paging.next);
    json = await res.json();
    if (json.error) throw new Error(`Meta API — ${json.error.message}`);
    out.push(...(json.data || []));
  }
  return out;
}
const valOf   = (arr, type) => Array.isArray(arr) ? Number(arr.find(a => a.action_type === type)?.value || 0) : 0;
const firstOf = (arr) => (Array.isArray(arr) && arr[0]) ? Number(arr[0].value) : 0;
const eur     = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nb      = (n) => n.toLocaleString('fr-FR');
const pct     = (n) => (n * 100).toFixed(1).replace('.', ',') + ' %';

// ── étape 1 : lister les campagnes ──────────────────────────────────────────
async function listCampaigns() {
  const camps = await apiAll(`${ACCOUNT}/campaigns`, { fields: 'id,name,status', limit: '100' });
  log(`\n=== Campagnes du compte ${ACCOUNT} (${camps.length}) ===`);
  camps.forEach(c => log(`  ${c.id}  [${c.status}]  ${c.name}`));
  log('\n👉 Copie l\'id (le long numéro au début) de ta campagne maître,');
  log('   ajoute META_CAMPAIGN_ID=... et CAMPAIGN_NUMBER=20 dans le .env, puis relance.');
}

// ── étape 2 : détail d'une campagne (par numéro) ────────────────────────────
async function detailCampaign() {
  const adsets = await apiAll(`${CAMPAIGN_ID}/adsets`, { fields: 'id,name,status', limit: '200' });
  const rx = NUMBER ? new RegExp(`^\\s*${NUMBER}\\b`) : null;
  const group = rx ? adsets.filter(a => rx.test(a.name)) : adsets;

  log(`\n=== Campagne ${CAMPAIGN_ID} — ${adsets.length} ad sets au total ===`);
  if (NUMBER) log(`Filtre préfixe « ${NUMBER} » → ${group.length} ad sets retenus`);
  if (NUMBER && group.length !== 2) log(`⚠️  Attendu : 2 ad sets (barbier + coiffeur). Vérifie le préfixe / le nommage.`);

  let totSpend = 0, totLead = 0;

  for (const as of group) {
    log(`\n──────────────────────────────────────────────`);
    log(`AD SET  ${as.name}  [${as.status}]`);

    const ins = (await api(`${as.id}/insights`, { fields: 'spend,impressions,actions', date_preset: DATE_PRESET })).data?.[0];
    const spend = ins ? Number(ins.spend) : 0;
    totSpend += spend;
    log(`  Dépensé : ${eur(spend)} €`);

    if (ins?.actions) {
      if (LEAD_ACTION) {
        const leads = valOf(ins.actions, LEAD_ACTION);
        totLead += leads;
        log(`  Leads « ${LEAD_ACTION} » : ${leads}`);
      } else {
        log('  ⚠️  LEAD_ACTION_TYPE non défini — voici TOUTES les conversions disponibles.');
        log('      Repère la ligne « Lead - Confirmation de RDV » et fige son action_type dans le .env :');
        ins.actions.forEach(a => log(`        • ${a.action_type} = ${a.value}`));
      }
    } else {
      log('  (aucune conversion sur la période)');
    }

    const ads = await apiAll(`${as.id}/ads`, { fields: 'id,name', limit: '50' });
    for (const ad of ads) {
      const v = (await api(`${ad.id}/insights`, {
        fields: ['impressions','video_play_actions','video_thruplay_watched_actions','video_avg_time_watched_actions',
                 'video_p25_watched_actions','video_p50_watched_actions','video_p75_watched_actions','video_p100_watched_actions'].join(','),
        date_preset: DATE_PRESET,
      })).data?.[0];

      log(`  PUB  ${ad.name}`);
      if (!v) { log('    (pas de données vidéo sur la période)'); continue; }

      const imp = Number(v.impressions || 0);
      const plays = firstOf(v.video_play_actions);
      const thru  = firstOf(v.video_thruplay_watched_actions);
      const avg   = firstOf(v.video_avg_time_watched_actions);
      const p25   = firstOf(v.video_p25_watched_actions);
      const p100  = firstOf(v.video_p100_watched_actions);

      log(`    Impressions          : ${nb(imp)}`);
      log(`    Vues (play)          : ${nb(plays)}`);
      log(`    ThruPlays            : ${nb(thru)}`);
      log(`    Temps moyen visionné : ${avg} s`);
      log(`    → Accroche (play / impressions)     ≈ ${imp ? pct(plays / imp) : '—'}`);
      log(`    → Accroche (thruplay / impressions) ≈ ${imp ? pct(thru / imp) : '—'}`);
      log(`    → Rétention (100% / 25% visionné)   ≈ ${p25 ? pct(p100 / p25) : '—'}`);
    }
  }

  log(`\n══════════════════════════════════════════════`);
  log(`TOTAL campagne « ${NUMBER || '(tous les ad sets)'} »`);
  log(`  Dépensé Meta : ${eur(totSpend)} €`);
  if (LEAD_ACTION) {
    log(`  Leads pixel  : ${totLead}`);
    log(`  Coût / lead pixel (façon Meta) : ${totLead ? eur(totSpend / totLead) : '—'} €`);
    log(`  Rappel : ton VRAI coût/lead = ${eur(totSpend)} € ÷ (RDV Calendly de la fenêtre)`);
  }
}

async function main() {
  if (!TOKEN)   { log('❌ Manque META_ACCESS_TOKEN dans le .env'); return; }
  if (!ACCOUNT && !CAMPAIGN_ID) { log('❌ Manque META_AD_ACCOUNT_ID (ou META_CAMPAIGN_ID) dans le .env'); return; }
  if (CAMPAIGN_ID) await detailCampaign();
  else await listCampaigns();
}

main()
  .catch(e => {
    log('\n❌ ' + e.message);
    if (String(e.message).includes('#100')) {
      log('   ↳ Souvent : l\'id du compte doit être préfixé « act_ », et le token doit avoir ads_read sur ce compte.');
    }
    if (String(e.message).toLowerCase().includes('expired') || String(e.message).includes('190')) {
      log('   ↳ Le token a probablement expiré (durée ≈ 1 h). Régénère-le au Graph API Explorer.');
    }
    process.exitCode = 1;
  })
  .finally(() => { flush(); log('\n📄 Résultat enregistré dans resultat-meta.txt'); flush(); });
