-- 星願物語 Starwish Online：線上資料庫結構（Stage 8.1，PostgreSQL 16；伺服器啟動時自動套用，可重複執行）
-- 原則：
--   1. 所有重要資產（角色、道具、金幣異動）都有唯一識別碼（UUID / bigserial）
--   2. 改變資產的動作都在「單一交易」內完成，並寫入 request_ledger（同一個請求只會生效一次）
--   3. 角色資料有 version（樂觀鎖）與 lock_epoch（工作階段鎖），舊連線或舊版本的寫入一律拒絕
--   4. 單機版 localStorage 存檔不匯入；線上角色只由伺服器建立
--   5. realm 區分資料區：測試伺服器只能寫 'test'；未來正式玩家使用 'prod'（建議另開正式資料庫，兩者永不混用）
-- 本檔只建立結構與原子操作函式，不含任何遊戲數值（掉落率、價格等仍未定案）。

CREATE TABLE IF NOT EXISTS accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS characters (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm            text NOT NULL DEFAULT 'test' CHECK (realm IN ('test', 'prod')),
  account_id       uuid REFERENCES accounts(id),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 12),
  gender           text NOT NULL CHECK (gender IN ('male', 'female')),
  -- 外觀與裝備造型（髮型、髮色、武器；伺服器驗證後寫入）
  appearance       jsonb NOT NULL DEFAULT '{"hair":"hair01","hairColor":null,"weapon":"sword"}'::jsonb,
  exp              bigint NOT NULL DEFAULT 0 CHECK (exp >= 0),
  map_id           text NOT NULL DEFAULT 'village' CHECK (map_id IN ('village', 'starsprout')),
  x                real,
  z                real,
  yaw              real NOT NULL DEFAULT 0,
  level            smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 20),
  gold             bigint NOT NULL DEFAULT 0 CHECK (gold >= 0),
  version          bigint NOT NULL DEFAULT 1,
  lock_owner       text,
  lock_epoch       bigint NOT NULL DEFAULT 0,
  lock_expires_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 登入憑證只存 SHA-256 雜湊
CREATE TABLE IF NOT EXISTS session_tokens (
  token_hash    text PRIMARY KEY,
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

-- 道具：每一件都有 UUID，裝備詞條／寵物鑑定等之後放 attrs（伺服器產生、永久固定）
CREATE TABLE IF NOT EXISTS items (
  uid         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES characters(id),
  def_id      text NOT NULL,
  qty         integer NOT NULL CHECK (qty > 0),
  state       text NOT NULL DEFAULT 'owned' CHECK (state IN ('owned', 'listed', 'consumed')),
  attrs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  version     bigint NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS items_owner_idx ON items(owner_id) WHERE state <> 'consumed';

-- 重複請求防護：同一角色同一 request_id 只會有一筆
CREATE TABLE IF NOT EXISTS request_ledger (
  character_id  uuid NOT NULL REFERENCES characters(id),
  request_id    text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  kind          text NOT NULL,
  result        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, request_id)
);

-- 金幣流水帳（可稽核；餘額不可為負由 characters.gold CHECK 保證）
CREATE TABLE IF NOT EXISTS gold_ledger (
  id             bigserial PRIMARY KEY,
  character_id   uuid NOT NULL REFERENCES characters(id),
  delta          bigint NOT NULL,
  balance_after  bigint NOT NULL,
  reason         text NOT NULL,
  request_id     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, request_id)
);

-- 道具異動紀錄
CREATE TABLE IF NOT EXISTS item_events (
  id          bigserial PRIMARY KEY,
  item_uid    uuid NOT NULL REFERENCES items(uid),
  from_owner  uuid,
  to_owner    uuid,
  kind        text NOT NULL,
  request_id  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 取得角色工作階段鎖：回傳新的 lock_epoch；之後只有帶這個 epoch 的寫入有效
CREATE OR REPLACE FUNCTION acquire_character_lock(p_char uuid, p_owner text, p_ttl interval)
RETURNS bigint LANGUAGE sql AS $$
  UPDATE characters
     SET lock_owner = p_owner, lock_epoch = lock_epoch + 1, lock_expires_at = now() + p_ttl
   WHERE id = p_char
  RETURNING lock_epoch;
$$;

-- 存位置：version 與 lock_epoch 都必須相符，否則回傳 NULL（呼叫端視為衝突）
CREATE OR REPLACE FUNCTION save_position(p_char uuid, p_expected_version bigint, p_epoch bigint, p_map text, p_x real, p_z real, p_yaw real)
RETURNS bigint LANGUAGE sql AS $$
  UPDATE characters
     SET map_id = p_map, x = p_x, z = p_z, yaw = p_yaw, version = version + 1, updated_at = now()
   WHERE id = p_char AND version = p_expected_version AND lock_epoch = p_epoch
  RETURNING version;
$$;

-- 金幣異動（冪等）：同 request_id 重送回傳第一次的結果；餘額不足時整筆不生效
CREATE OR REPLACE FUNCTION change_gold(p_request text, p_char uuid, p_delta bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_prev jsonb;
  v_bal  bigint;
  v_res  jsonb;
BEGIN
  INSERT INTO request_ledger(character_id, request_id, kind, result)
  VALUES (p_char, p_request, 'gold', '{"pending":true}')
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT result INTO v_prev FROM request_ledger WHERE character_id = p_char AND request_id = p_request;
    RETURN v_prev || '{"dup":true}';
  END IF;
  UPDATE characters SET gold = gold + p_delta, version = version + 1, updated_at = now()
   WHERE id = p_char AND gold + p_delta >= 0
  RETURNING gold INTO v_bal;
  IF v_bal IS NULL THEN
    v_res := '{"ok":false,"err":"insufficient_gold"}';
  ELSE
    INSERT INTO gold_ledger(character_id, delta, balance_after, reason, request_id) VALUES (p_char, p_delta, v_bal, p_reason, p_request);
    v_res := jsonb_build_object('ok', true, 'balance', v_bal);
  END IF;
  UPDATE request_ledger SET result = v_res WHERE character_id = p_char AND request_id = p_request;
  RETURN v_res;
END $$;

-- 道具轉移（冪等＋原子）：鎖定道具列、檢查擁有者／狀態／版本，全部成功才生效
CREATE OR REPLACE FUNCTION transfer_item(p_request text, p_from uuid, p_to uuid, p_item uuid, p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_prev jsonb;
  v_item items%ROWTYPE;
  v_res  jsonb;
BEGIN
  INSERT INTO request_ledger(character_id, request_id, kind, result)
  VALUES (p_from, p_request, 'transfer_item', '{"pending":true}')
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT result INTO v_prev FROM request_ledger WHERE character_id = p_from AND request_id = p_request;
    RETURN v_prev || '{"dup":true}';
  END IF;
  SELECT * INTO v_item FROM items WHERE uid = p_item FOR UPDATE;
  IF NOT FOUND OR v_item.owner_id <> p_from OR v_item.state <> 'owned' THEN
    v_res := '{"ok":false,"err":"not_owner"}';
  ELSIF v_item.version <> p_expected_version THEN
    v_res := jsonb_build_object('ok', false, 'err', 'version_conflict', 'current', v_item.version);
  ELSE
    UPDATE items SET owner_id = p_to, version = version + 1, updated_at = now() WHERE uid = p_item;
    INSERT INTO item_events(item_uid, from_owner, to_owner, kind, request_id) VALUES (p_item, p_from, p_to, 'transfer', p_request);
    v_res := jsonb_build_object('ok', true, 'version', v_item.version + 1);
  END IF;
  UPDATE request_ledger SET result = v_res WHERE character_id = p_from AND request_id = p_request;
  RETURN v_res;
END $$;

-- 版本紀錄
CREATE TABLE IF NOT EXISTS schema_meta (
  key    text PRIMARY KEY,
  value  text NOT NULL
);
INSERT INTO schema_meta(key, value) VALUES ('schema_version', '8.1') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
CREATE INDEX IF NOT EXISTS characters_realm_idx ON characters(realm);

-- Stage 8.2／8.3：倉庫位置、裝備欄、道具給予函式（可重複執行）
ALTER TABLE items ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT 'bag';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_location_check') THEN
    ALTER TABLE items ADD CONSTRAINT items_location_check CHECK (location IN ('bag', 'storage'));
  END IF;
END $$;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS equipment jsonb NOT NULL DEFAULT '{}'::jsonb;
INSERT INTO schema_meta(key, value) VALUES ('schema_version', '8.2') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Stage 8.5：正式帳號（與角色資料分開）、登入憑證、交易紀錄（可重複執行）
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS realm text NOT NULL DEFAULT 'test';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pass_hash text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_realm_check') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_realm_check CHECK (realm IN ('test', 'prod'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_username_check') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_username_check CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$');
  END IF;
END $$;
-- 同一資料區內帳號名稱唯一（存小寫）
CREATE UNIQUE INDEX IF NOT EXISTS accounts_realm_username_uq ON accounts(realm, username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS characters_account_idx ON characters(account_id) WHERE account_id IS NOT NULL;

-- 帳號登入憑證：只存 SHA-256 雜湊；有到期時間；登出即撤銷
CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash  text PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm       text NOT NULL CHECK (realm IN ('test', 'prod')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX IF NOT EXISTS account_sessions_account_idx ON account_sessions(account_id);

-- 交易稽核：每筆成交一列（雙方、交換內容）
CREATE TABLE IF NOT EXISTS trade_log (
  id          bigserial PRIMARY KEY,
  request_id  text NOT NULL UNIQUE,
  char_a      uuid NOT NULL REFERENCES characters(id),
  char_b      uuid NOT NULL REFERENCES characters(id),
  detail      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_meta(key, value) VALUES ('schema_version', '8.5') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
