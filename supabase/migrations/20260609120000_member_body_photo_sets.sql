-- 会員体型写真（正面・背面・左横・右横）を日付ごとに保存
CREATE TABLE IF NOT EXISTS public.member_body_photo_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  photo_date date NOT NULL,
  front_path text,
  back_path text,
  side_left_path text,
  side_right_path text,
  uploaded_by_trainer_id uuid REFERENCES public.trainers (id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, photo_date)
);

CREATE INDEX IF NOT EXISTS member_body_photo_sets_member_date_idx
  ON public.member_body_photo_sets (member_id, photo_date DESC);

-- Supabase Storage（private バケット）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'member-body-photos',
  'member-body-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
