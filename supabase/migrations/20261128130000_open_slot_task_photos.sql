-- 上野店の空き枠掃除で添付する写真
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'open-slot-task-photos',
  'open-slot-task-photos',
  false,
  2097152,
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO NOTHING;
