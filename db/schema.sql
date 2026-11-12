-- LoveLink schema (PostgreSQL). Compatible with pg-mem for local testing.
-- Mobile-first dating app: 18+ only, questionnaire profiles, real location,
-- mutual-like matches, chat inside matches, 3 free matches then premium paywall.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  email_token TEXT,
  reset_token TEXT,
  reset_expires TIMESTAMPTZ,
  google_id TEXT UNIQUE,
  avatar_url TEXT,
  gender TEXT CHECK (gender IS NULL OR gender IN ('male','female')),
  age INT CHECK (age IS NULL OR (age >= 18 AND age <= 100)),
  is_demo BOOLEAN DEFAULT FALSE,
  is_banned BOOLEAN DEFAULT FALSE,
  is_premium BOOLEAN DEFAULT FALSE,
  free_matches_used INT DEFAULT 0,
  notify_platform BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Questionnaire / dating profile (one row per user, filled in onboarding)
CREATE TABLE IF NOT EXISTS profiles (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  city TEXT,
  country TEXT DEFAULT 'Ethiopia',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  height_cm INT,
  religion TEXT,
  education TEXT,
  job TEXT,
  smoking TEXT CHECK (smoking IS NULL OR smoking IN ('never','sometimes','often')),
  drinking TEXT CHECK (drinking IS NULL OR drinking IN ('never','sometimes','often')),
  kids TEXT CHECK (kids IS NULL OR kids IN ('none','have','want','dont_want')),
  looking_for_gender TEXT CHECK (looking_for_gender IS NULL OR looking_for_gender IN ('female','male','any')),
  age_min INT DEFAULT 18,
  age_max INT DEFAULT 99,
  relationship_goal TEXT CHECK (relationship_goal IS NULL OR relationship_goal IN ('serious','casual','friendship','marriage')),
  interests TEXT DEFAULT '',
  languages TEXT DEFAULT 'Amharic, English',
  photo1 TEXT,
  photo2 TEXT,
  photo3 TEXT,
  online BOOLEAN DEFAULT TRUE,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS swipes (
  id SERIAL PRIMARY KEY,
  from_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('like','pass','super')),
  is_direct BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_user_id, to_user_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  user_a_id INT REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INT REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_a_id, user_b_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  match_id INT UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  user_a_id INT REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INT REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  image_data TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_reads (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','dismissed','actioned')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INT REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INT REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  receipt_data TEXT,
  amount_etb INT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  type TEXT DEFAULT 'premium' CHECK (type IN ('premium')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT,
  title TEXT,
  body TEXT,
  link TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes: every FK + every hot query path
CREATE INDEX IF NOT EXISTS idx_profiles_city ON profiles (city);
CREATE INDEX IF NOT EXISTS idx_profiles_online ON profiles (online, last_active DESC);
CREATE INDEX IF NOT EXISTS idx_swipes_from ON swipes (from_user_id);
CREATE INDEX IF NOT EXISTS idx_swipes_to ON swipes (to_user_id);
CREATE INDEX IF NOT EXISTS idx_matches_a ON matches (user_a_id);
CREATE INDEX IF NOT EXISTS idx_matches_b ON matches (user_b_id);
CREATE INDEX IF NOT EXISTS idx_conversations_a ON conversations (user_a_id);
CREATE INDEX IF NOT EXISTS idx_conversations_b ON conversations (user_b_id);
CREATE INDEX IF NOT EXISTS idx_conversations_match ON conversations (match_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports (reported_user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);

-- Thumbnails (light+fast): small 360px versions of photos, used in cards,
-- grids and avatars so list pages don't re-download full ~60-150KB photos.
-- Idempotent ALTERs: safe to re-run on every boot, old rows keep working
-- (NULL thumb = fall back to the full photo; backfilled on the fly).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS photo1_thumb TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS photo2_thumb TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS photo3_thumb TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_thumb TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_thumb TEXT;
-- Reference-rebuild prefs (v5): zodiac + birth place shown in About Me;
-- incognito / verified-only / preferred religion are real Settings filters.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS zodiac TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birth_place TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS incognito BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_only BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pref_religion TEXT;

-- Selfie verification (v6): the blue verified badge now means the user
-- passed a selfie check (or is a demo profile) — email verification no
-- longer grants the badge. One pending selfie per user at a time; a new
-- submission replaces the old pending one. Selfies are shown ONLY to the
-- admin, never on any public profile.
ALTER TABLE users ADD COLUMN IF NOT EXISTS selfie_verified BOOLEAN DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS verifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_verifications_status ON verifications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verifications_user ON verifications (user_id);

CREATE INDEX IF NOT EXISTS idx_verifications_status ON verifications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verifications_user ON verifications (user_id);

-- Like-back paywall bypass: who liked FIRST on each match. The user who
-- liked second (responding to an incoming like) always chats free; the
-- initiator spends the 3-free-matches budget. NULL = match formed before
-- this change: existing behavior, no new bypass. Plain INT, no FK —
-- keeps pg-mem compatibility (the local test DB) with the other ALTERs.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS initiated_by_id INT;

-- Like-based paywall: how each swipe was classified when it was made.
-- TRUE = direct like (no incoming like existed — spends the 3-free-likes
-- budget), FALSE = like-back (always free, never spends it), NULL =
-- legacy swipe from before this change (never counts — fresh start on
-- likes). Passes leave it NULL; only like/super rows carry a value.
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS is_direct BOOLEAN;
