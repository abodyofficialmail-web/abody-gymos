-- 当日空き枠で実行したタスクの報告
CREATE TABLE IF NOT EXISTS public.open_slot_task_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id),
  slot_start_at timestamptz NOT NULL,
  slot_end_at timestamptz NOT NULL,
  task_key text NOT NULL,
  task_label text NOT NULL,
  detail text,
  operator_trainer_id uuid REFERENCES public.trainers (id) ON DELETE SET NULL,
  operator_name text,
  member_id uuid REFERENCES public.members (id) ON DELETE SET NULL,
  member_label text,
  reservation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS open_slot_task_reports_store_slot_idx
  ON public.open_slot_task_reports (store_id, slot_start_at DESC);

ALTER TABLE public.open_slot_task_reports ENABLE ROW LEVEL SECURITY;
