-- Date de création de la réservation Calendly (invitee.created_at, Calendly
-- API v2 — distinct de appointments.created_at qui est l'horodatage de la
-- ligne en base). Utilisée pour le rattachement à une campagne (une
-- conversion appartient à la campagne active au moment où la réservation est
-- créée, pas à la date prévue du rendez-vous — voir lib/sync/syncAppointments.ts)
-- et pour les statistiques quotidiennes Calendly (lib/sync/syncCalendlyDailyStats.ts).
-- start_time reste inchangée et continue de représenter la date prévue du
-- rendez-vous (information opérationnelle uniquement, plus utilisée pour le
-- rattachement).
--
-- Nullable : les rendez-vous déjà synchronisés n'ont pas encore cette valeur
-- tant qu'une prochaine synchro ne l'a pas récupérée (voir la logique
-- d'enrichissement incrémental dans lib/sync/syncAppointments.ts, qui
-- re-sollicite /invitees pour tout rendez-vous dont ce champ est encore nul,
-- même si le canal d'acquisition est déjà connu).
alter table public.appointments
  add column if not exists booking_created_at timestamptz;
