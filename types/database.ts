export type UserRole = 'admin' | 'client'
export type AudienceType = 'barbier' | 'coiffeur'
export type SyncRunStatus = 'running' | 'success' | 'failed'
export type AppointmentStatus = 'active' | 'canceled'

export type Client = {
  id: string
  name: string
  slug: string
  created_at: string
}

export type Profile = {
  id: string
  client_id: string | null
  role: UserRole
  full_name: string | null
  created_at: string
}

export type Campaign = {
  id: string
  client_id: string
  meta_campaign_id: string
  campaign_number: number
  name: string
  start_date: string | null
  end_date: string | null
  status: string | null
  // État Meta (ci-dessus, status) vs état de publication dashboard
  // (published) : deux notions indépendantes. published contrôle
  // exclusivement la visibilité côté client (app/dashboard/*) ; jamais
  // modifié automatiquement par la synchro (voir lib/sync/syncCampaign.ts),
  // seul un admin le change (app/api/admin/campaigns/publish/route.ts).
  published: boolean
  // Verrouillage de synchro définitif, indépendant de status ET de published
  // ci-dessus. sync_locked=true : plus jamais resynchronisée (Meta ni
  // Calendly, voir lib/sync/syncAllCampaigns.ts, syncAllCampaignsDailyStats.ts,
  // syncAppointments.ts) — valeurs figées comme référence historique. Décision
  // admin/initialisation ponctuelle, jamais modifiée par une synchro.
  sync_locked: boolean
  meta_spend: number
  meta_pixel_leads: number
  calendly_appointments: number
  manual_appointments_adjustment: number
  created_at: string
  updated_at: string
}

export type Audience = {
  id: string
  campaign_id: string
  meta_adset_id: string
  audience_type: AudienceType
  name: string
  meta_spend: number
  meta_pixel_leads: number
  // Répartition des leads par plateforme — donnée de l'import historique
  // Excel (lib/import/importHistoricalExcel.ts), jamais renseignée par la
  // synchro Meta réelle (nullable, migration 20260808000000).
  facebook_leads: number | null
  instagram_leads: number | null
  created_at: string
  updated_at: string
}

export type Video = {
  id: string
  audience_id: string
  meta_ad_id: string
  name: string
  // Nom métier affiché dans le dashboard : titre réel du fichier vidéo
  // importé dans Meta (node Vidéo, champ title — lib/sync/meta.ts,
  // fetchVideoTitle), distinct de name ci-dessus (nom de la PUB, Ads
  // Manager). Priorité d'affichage : video_display_name -> name -> "Vidéo"
  // (voir app/dashboard/campaigns/[id]/page.tsx, comparison/VideoRanking.tsx).
  // Nullable : non résolu (pub non vidéo, permission refusée...) ou campagne
  // historique jamais resynchronisée (n°1 à 11, renseigné manuellement).
  video_display_name: string | null
  // Nullable depuis la migration 20260808000000 : l'import historique Excel
  // (lib/import/importHistoricalExcel.ts) ne fournit pas ces compteurs bruts
  // Meta (aucune colonne équivalente dans le fichier source), seulement des
  // taux déjà calculés (voir hook_rate_pct/retention_rate_pct ci-dessous).
  // NULL = donnée réellement absente, jamais 0 (0 impliquerait une vraie
  // mesure nulle). Toujours un nombre réel pour une vidéo synchronisée via
  // Meta (lib/sync/mapper.ts, mapAdToVideoInsert, jamais affecté).
  impressions: number | null
  video_plays: number
  video_plays_3s: number | null
  thruplays: number | null
  average_watch_time_seconds: number
  video_p25: number | null
  video_p50: number | null
  video_p75: number | null
  video_p100: number | null
  // Taux d'accroche/de rétention déjà calculés (import historique Excel),
  // en ratio 0-1 comme hookRate()/retentionRate() (lib/calculations.ts) —
  // utilisés uniquement en repli quand video_plays_3s/impressions/video_p100
  // ci-dessus sont absents (voir app/dashboard/campaigns/[id]/page.tsx).
  // Jamais renseignés par la synchro Meta réelle.
  hook_rate_pct: number | null
  retention_rate_pct: number | null
  created_at: string
  updated_at: string
}

export type AppointmentBreakdown = {
  id: string
  campaign_id: string
  instagram_count: number
  facebook_count: number
  age_18_24: number
  age_25_34: number
  age_35_44: number
  age_45_54: number
  age_55_plus: number
  created_at: string
  updated_at: string
}

export type SyncRun = {
  id: string
  client_id: string
  started_by: string | null
  status: SyncRunStatus
  started_at: string
  finished_at: string | null
  error_message: string | null
}

// Rendez-vous Calendly, source de vérité (voir BRIEF-CLAUDE-CODE.md section 3).
// Volontairement sans nom/email/téléphone/réponses libres (donnée personnelle
// non nécessaire). acquisition_channel est un canal ouvert (Instagram, TikTok,
// Google observés — pas un sélecteur binaire Instagram/Facebook) ; aucune
// ventilation Barbier/Coiffeur n'existe côté Calendly, campaign_id est donc
// nullable et ne porte aucune répartition par audience.
export type Appointment = {
  id: string
  client_id: string
  campaign_id: string | null
  calendly_event_uri: string
  event_type_uri: string
  // Date prévue du rendez-vous — information opérationnelle uniquement,
  // n'est plus utilisée pour le rattachement à une campagne (voir
  // booking_created_at ci-dessous et lib/sync/syncAppointments.ts).
  start_time: string
  status: AppointmentStatus
  acquisition_channel: string | null
  // Date de création de la réservation Calendly (invitee.created_at, Calendly
  // API) — c'est ce champ, pas start_time, qui détermine à quelle campagne un
  // rendez-vous appartient (une conversion appartient à la campagne active au
  // moment de la réservation). Nullable : absent tant qu'une synchro ne l'a
  // pas encore récupéré (voir migration 20260806000000).
  booking_created_at: string | null
  created_at: string
  updated_at: string
}

// Statistiques Meta/Calendly agrégées par jour et par campagne (préparation du
// futur filtre de période, voir BRIEF-CLAUDE-CODE.md — table créée par la
// migration mais pas encore alimentée par une synchro). client_id est
// toujours cohérent avec la campagne (contrainte base, voir la migration).
export type CampaignDailyStat = {
  id: string
  client_id: string
  campaign_id: string
  stat_date: string
  meta_spend: number
  meta_pixel_leads: number
  calendly_appointments: number
  created_at: string
  updated_at: string
}

// Type minimal pour typer les clients Supabase (@supabase/supabase-js, @supabase/ssr).
// Non généré par la CLI Supabase (CLI non configurée à ce stade) : à tenir à jour manuellement
// si le schéma évolue.
export interface Database {
  public: {
    Tables: {
      clients: {
        Row: Client
        Insert: Partial<Pick<Client, 'id' | 'created_at'>> & Omit<Client, 'id' | 'created_at'>
        Update: Partial<Client>
        Relationships: []
      }
      profiles: {
        Row: Profile
        Insert: Partial<Pick<Profile, 'created_at'>> & Omit<Profile, 'created_at'>
        Update: Partial<Profile>
        Relationships: []
      }
      campaigns: {
        Row: Campaign
        // start_date/end_date/status (nullable), calendly_appointments/
        // manual_appointments_adjustment (saisie manuelle, jamais dérivés de Meta),
        // published (décision admin) et sync_locked (verrouillage définitif,
        // décision admin/initialisation) sont optionnels à l'insert : la
        // synchro Meta ne doit jamais les écraser en les omettant du payload
        // d'upsert (lib/sync/syncCampaign.ts) — published/sync_locked ont un
        // défaut false en base, appliqué uniquement à la création.
        Insert: Partial<
          Pick<
            Campaign,
            | 'id'
            | 'created_at'
            | 'updated_at'
            | 'start_date'
            | 'end_date'
            | 'status'
            | 'published'
            | 'sync_locked'
            | 'calendly_appointments'
            | 'manual_appointments_adjustment'
          >
        > &
          Omit<
            Campaign,
            | 'id'
            | 'created_at'
            | 'updated_at'
            | 'start_date'
            | 'end_date'
            | 'status'
            | 'published'
            | 'sync_locked'
            | 'calendly_appointments'
            | 'manual_appointments_adjustment'
          >
        Update: Partial<Campaign>
        Relationships: []
      }
      audiences: {
        Row: Audience
        // facebook_leads/instagram_leads optionnels à l'insert : seul
        // l'import historique Excel les renseigne (lib/import/
        // importHistoricalExcel.ts) ; la synchro Meta réelle (mapper.ts) les
        // omet du payload, défaut colonne NULL appliqué à la création.
        Insert: Partial<Pick<Audience, 'id' | 'created_at' | 'updated_at' | 'facebook_leads' | 'instagram_leads'>> &
          Omit<Audience, 'id' | 'created_at' | 'updated_at' | 'facebook_leads' | 'instagram_leads'>
        Update: Partial<Audience>
        Relationships: []
      }
      videos: {
        Row: Video
        // hook_rate_pct/retention_rate_pct optionnels à l'insert : seul
        // l'import historique Excel les renseigne (même raison que
        // facebook_leads/instagram_leads ci-dessus).
        Insert: Partial<Pick<Video, 'id' | 'created_at' | 'updated_at' | 'hook_rate_pct' | 'retention_rate_pct'>> &
          Omit<Video, 'id' | 'created_at' | 'updated_at' | 'hook_rate_pct' | 'retention_rate_pct'>
        Update: Partial<Video>
        Relationships: []
      }
      appointment_breakdowns: {
        Row: AppointmentBreakdown
        // instagram_count/facebook_count optionnels à l'insert : répartition
        // RDV par plateforme, hors périmètre de la synchro par tranche d'âge
        // (lib/sync/mapper.ts, mapAgeInsightsToBreakdownInsert) — jamais
        // renseignés par elle, défaut colonne (0) préservé tel quel, même
        // principe que facebook_leads/instagram_leads sur audiences ci-dessus.
        Insert: Partial<
          Pick<AppointmentBreakdown, 'id' | 'created_at' | 'updated_at' | 'instagram_count' | 'facebook_count'>
        > &
          Omit<AppointmentBreakdown, 'id' | 'created_at' | 'updated_at' | 'instagram_count' | 'facebook_count'>
        Update: Partial<AppointmentBreakdown>
        Relationships: []
      }
      sync_runs: {
        Row: SyncRun
        Insert: Partial<Pick<SyncRun, 'id' | 'started_at' | 'finished_at' | 'error_message'>> &
          Omit<SyncRun, 'id' | 'started_at' | 'finished_at' | 'error_message'>
        Update: Partial<SyncRun>
        Relationships: []
      }
      appointments: {
        Row: Appointment
        Insert: Partial<
          Pick<Appointment, 'id' | 'created_at' | 'updated_at' | 'campaign_id' | 'acquisition_channel' | 'booking_created_at'>
        > &
          Omit<Appointment, 'id' | 'created_at' | 'updated_at' | 'campaign_id' | 'acquisition_channel' | 'booking_created_at'>
        Update: Partial<Appointment>
        Relationships: []
      }
      campaign_daily_stats: {
        Row: CampaignDailyStat
        Insert: Partial<
          Pick<
            CampaignDailyStat,
            'id' | 'created_at' | 'updated_at' | 'meta_spend' | 'meta_pixel_leads' | 'calendly_appointments'
          >
        > &
          Omit<
            CampaignDailyStat,
            'id' | 'created_at' | 'updated_at' | 'meta_spend' | 'meta_pixel_leads' | 'calendly_appointments'
          >
        Update: Partial<CampaignDailyStat>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
