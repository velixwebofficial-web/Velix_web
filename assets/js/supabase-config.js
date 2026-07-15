/* ==========================================================================
   SUPABASE CONFIG
   The URL + anon key are meant to be public — they are safe to ship in
   client-side JS. Actual data protection comes from the Row Level Security
   policies in supabase/schema.sql (anon can only read published rows;
   writes require a logged-in staff account).

   Fill these in from: Supabase Dashboard > Project Settings > API.
   ========================================================================== */
window.VELIX_SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
window.VELIX_SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
