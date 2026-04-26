ALTER TABLE public.reservations
ADD COLUMN IF NOT EXISTS session_type text;
