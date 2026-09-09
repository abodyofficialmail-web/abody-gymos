-- LINE一括配信用メディア（動画・プレビュー画像）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'line-campaign-media',
  'line-campaign-media',
  false,
  20971520,
  ARRAY['video/mp4', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
