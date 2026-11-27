-- 星願物語 Starwish Online：線上資料庫結構草案（Stage 8.0，PostgreSQL 16）
-- 原則：
--   1. 所有重要資產（角色、道具、金幣異動）都有唯一識別碼（UUID / bigserial）
--   2. 改變資產的動作都在「單一交易」內完成，並寫入 request_ledger（同一個請求只會生效一次）
--   3. 角色資料有 version（樂觀鎖）與 lock_epoch（工作階段鎖），舊連線或舊版本的寫入一律拒絕
--   4. 單機版 localStorage 存檔不匯入；線上角色只由伺服器建立
-- 本檔只建立結構與原子操作函式，不含任何遊戲數值（掉落率、價格等仍未定案）。

CREATE TABLE accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE characters (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid REFERENCES accounts(id),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 12),
  gender           text NOT NULL CHECK (gender IN ('male', 'female')),
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
CREATE TABLE session_tokens (
  token_hash    text PRIMARY KEY,
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

-- 道具：每一件都有 UUID，裝備詞條／寵物鑑定等之後放 attrs（伺服器產生、永久固定）
CREATE TABLE items (
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
CREATE INDEX items_owner_idx ON items(owner_id) WHERE state <> 'consumed';

-- 重複請求防護：同一角色同一 request_id 只會有一筆
CREATE TABLE request_ledger (
  character_id  uuid NOT NULL REFERENCES characters(id),
  request_id    text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  kind          text NOT NULL,
  result        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, request_id)
);

-- 金幣流水帳（可稽核；餘額不可為負由 characters.gold CHECK 保證）
CREATE TABLE gold_ledger (
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
CREATE TABLE item_events (
  id          bigserial PRIMARY KEY,
  item_uid    uuid NOT NULL REFERENCES items(uid),
  from_owner  uuid,
  to_owner    uuid,
  kind        text NOT NULL,
  request_id  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 取得角色工作階段鎖：回傳新的 lock_epoch；之後只有帶這個 epoch 的寫入有效
CREATE FUNCTION acquire_character_lock(p_char uuid, p_owner text, p_ttl interval)
RETURNS bigint LANGUAGE sql AS $$
  UPDATE characters
     SET lock_owner = p_owner, lock_epoch = lock_epoch + 1, lock_expires_at = now() + p_ttl
   WHERE id = p_char
  RETURNING lock_epoch;
$$;

-- 存位置：version 與 lock_epoch 都必須相符，否則回傳 NULL（呼叫端視為衝突）
CREATE FUNCTION save_position(p_char uuid, p_expected_version bigint, p_epoch bigint, p_map text, p_x real, p_z real, p_yaw real)
RETURNS bigint LANGUAGE sql AS $$
  UPDATE characters
     SET map_id = p_map, x = p_x, z = p_z, yaw = p_yaw, version = version + 1, updated_at = now()
   WHERE id = p_char AND version = p_expected_version AND lock_epoch = p_epoch
  RETURNING version;
$$;

-- 金幣異動（冪等）：同 request_id 重送回傳第一次的結果；餘額不足時整筆不生效
CREATE FUNCTION change_gold(p_request text, p_char uuid, p_delta bigint, p_reason text)
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
CREATE FUNCTION transfer_item(p_request text, p_from uuid, p_to uuid, p_item uuid, p_expected_version bigint)
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
