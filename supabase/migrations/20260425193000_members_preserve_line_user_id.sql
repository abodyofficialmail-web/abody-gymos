-- Prevent accidental wiping of LINE linkage during partial updates/imports.
-- If an UPDATE tries to set line_user_id to NULL while a non-null value already exists,
-- keep the existing value.

CREATE OR REPLACE FUNCTION public.preserve_members_line_user_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.line_user_id IS NULL AND OLD.line_user_id IS NOT NULL THEN
    NEW.line_user_id := OLD.line_user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS members_preserve_line_user_id_trg ON public.members;
CREATE TRIGGER members_preserve_line_user_id_trg
BEFORE UPDATE ON public.members
FOR EACH ROW
EXECUTE FUNCTION public.preserve_members_line_user_id();
