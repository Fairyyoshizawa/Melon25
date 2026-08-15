CREATE TABLE IF NOT EXISTS public.saves (
  device_id text PRIMARY KEY,
  endless_unlocked boolean NOT NULL DEFAULT false,
  perfect_echo_cleared boolean NOT NULL DEFAULT false,
  best_day integer NOT NULL DEFAULT 0,
  achievements jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{"sound": true, "shake": true}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saves ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.saves TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "anon_own_saves" ON public.saves;
CREATE POLICY "anon_own_saves"
  ON public.saves
  FOR ALL
  TO anon
  USING (device_id = current_setting('request.headers', true)::json->>'x-device-id')
  WITH CHECK (device_id = current_setting('request.headers', true)::json->>'x-device-id');
