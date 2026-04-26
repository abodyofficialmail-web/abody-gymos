ALTER TABLE public.stores
ADD COLUMN IF NOT EXISTS booking_cutoff_prev_day_time text NOT NULL DEFAULT '22:00';

