-- 会員が成分表から確定したJANマスタ。同じ番号は2回目から出る。

CREATE TABLE IF NOT EXISTS public.meal_barcode_products (
  barcode text PRIMARY KEY,
  name text NOT NULL,
  kcal numeric(6, 0) NOT NULL CHECK (kcal >= 0 AND kcal <= 5000),
  protein_g numeric(5, 1) NOT NULL CHECK (protein_g >= 0 AND protein_g <= 400),
  fat_g numeric(5, 1) NOT NULL CHECK (fat_g >= 0 AND fat_g <= 400),
  carb_g numeric(5, 1) NOT NULL CHECK (carb_g >= 0 AND carb_g <= 800),
  confirm_count integer NOT NULL DEFAULT 1 CHECK (confirm_count >= 1),
  last_member_id uuid REFERENCES public.members (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meal_barcode_products_updated_idx
  ON public.meal_barcode_products (updated_at DESC);

COMMENT ON TABLE public.meal_barcode_products IS
  'User-confirmed JAN nutrition master. First save comes from a label; later scans reuse it.';

ALTER TABLE public.meal_barcode_products ENABLE ROW LEVEL SECURITY;
