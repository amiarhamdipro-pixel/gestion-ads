export type UserRole = 'admin' | 'client'
export type AudienceType = 'barbier' | 'coiffeur'
export type SyncRunStatus = 'running' | 'success' | 'failed'

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
  created_at: string
  updated_at: string
}

export type Video = {
  id: string
  audience_id: string
  meta_ad_id: string
  name: string
  impressions: number
  video_plays: number
  thruplays: number
  average_watch_time_seconds: number
  video_p25: number
  video_p50: number
  video_p75: number
  video_p100: number
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
        // start_date/end_date/status (nullable) et calendly_appointments/
        // manual_appointments_adjustment (saisie manuelle, jamais dérivés de Meta)
        // sont optionnels à l'insert : la synchro Meta ne doit jamais les écraser
        // en les omettant du payload d'upsert (lib/sync/syncCampaign.ts).
        Insert: Partial<
          Pick<
            Campaign,
            | 'id'
            | 'created_at'
            | 'updated_at'
            | 'start_date'
            | 'end_date'
            | 'status'
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
            | 'calendly_appointments'
            | 'manual_appointments_adjustment'
          >
        Update: Partial<Campaign>
        Relationships: []
      }
      audiences: {
        Row: Audience
        Insert: Partial<Pick<Audience, 'id' | 'created_at' | 'updated_at'>> &
          Omit<Audience, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Audience>
        Relationships: []
      }
      videos: {
        Row: Video
        Insert: Partial<Pick<Video, 'id' | 'created_at' | 'updated_at'>> &
          Omit<Video, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Video>
        Relationships: []
      }
      appointment_breakdowns: {
        Row: AppointmentBreakdown
        Insert: Partial<Pick<AppointmentBreakdown, 'id' | 'created_at' | 'updated_at'>> &
          Omit<AppointmentBreakdown, 'id' | 'created_at' | 'updated_at'>
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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
