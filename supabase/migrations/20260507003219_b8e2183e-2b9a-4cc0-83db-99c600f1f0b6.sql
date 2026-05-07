-- Admin account (singleton)
CREATE TABLE public.admin_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enforce singleton via partial unique index on a constant
CREATE UNIQUE INDEX admin_account_singleton ON public.admin_account ((true));

ALTER TABLE public.admin_account ENABLE ROW LEVEL SECURITY;
-- No policies => denied to anon/auth roles. Service role bypasses RLS.

CREATE TRIGGER admin_account_updated_at
  BEFORE UPDATE ON public.admin_account
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Admin sessions
CREATE TABLE public.admin_sessions (
  token text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
-- No policies => locked down to service role only.

CREATE INDEX admin_sessions_expires_at ON public.admin_sessions (expires_at);