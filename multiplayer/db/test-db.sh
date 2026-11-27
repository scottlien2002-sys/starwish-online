#!/usr/bin/env bash
# 在本機暫時資料夾啟動 PostgreSQL 16（不碰任何雲端、不常駐），套用 schema.sql 並實測：
#   唯一識別碼、冪等請求、樂觀鎖、工作階段鎖、金幣不可為負、並行轉移同一道具只有一筆成功
# 執行（需要本機 PostgreSQL 16 與 postgres 系統帳號）：bash multiplayer/db/test-db.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
PGBIN=/usr/lib/postgresql/16/bin
tmp="$(mktemp -d /tmp/starwish-pg.XXXX)"
chown postgres "$tmp"
as_pg() { runuser -u postgres -- "$@"; }
as_pg "$PGBIN/initdb" -D "$tmp/data" -A trust -U postgres >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$tmp/data" -o "-k $tmp -p 55432 -c listen_addresses=''" -l "$tmp/log" start -w >/dev/null
PSQL=(runuser -u postgres -- psql -h "$tmp" -p 55432 -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
"${PSQL[@]}" -c "CREATE DATABASE starwish" >/dev/null
DB=("${PSQL[@]}" -d starwish)
pass=0; fail=0
check() { if [ "$2" == "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 (expected '$3', got '$2')"; fail=$((fail+1)); fi; }

"${DB[@]}" -f "$here/schema.sql" >/dev/null && check "schema.sql 套用成功" ok ok

A=$("${DB[@]}" -c "INSERT INTO characters(name, gender) VALUES ('阿星','male') RETURNING id")
B=$("${DB[@]}" -c "INSERT INTO characters(name, gender) VALUES ('小願','female') RETURNING id")
C=$("${DB[@]}" -c "INSERT INTO characters(name, gender) VALUES ('路人','male') RETURNING id")
check "角色 UUID 唯一" "$("${DB[@]}" -c "SELECT count(DISTINCT id) FROM characters")" 3

# 工作階段鎖＋樂觀鎖
E1=$("${DB[@]}" -c "SELECT acquire_character_lock('$A','srv-1','30 seconds')")
V=$("${DB[@]}" -c "SELECT save_position('$A',1,$E1,'village',1,2,0)")
check "正確 version＋epoch 可存檔" "$V" 2
check "舊 version 寫入被拒" "$("${DB[@]}" -c "SELECT coalesce(save_position('$A',1,$E1,'village',9,9,0)::text,'rejected')")" rejected
E2=$("${DB[@]}" -c "SELECT acquire_character_lock('$A','srv-2','30 seconds')")
check "被搶走工作階段鎖的舊連線寫入被拒" "$("${DB[@]}" -c "SELECT coalesce(save_position('$A',2,$E1,'village',9,9,0)::text,'rejected')")" rejected
check "新連線（新 epoch）可寫入" "$("${DB[@]}" -c "SELECT save_position('$A',2,$E2,'starsprout',3,4,0)")" 3

# 金幣：冪等＋不可為負
check "加 100 金幣" "$("${DB[@]}" -c "SELECT change_gold('req-gold-0001','$A',100,'test')->>'balance'")" 100
check "同 request 重送不重複加錢" "$("${DB[@]}" -c "SELECT change_gold('req-gold-0001','$A',100,'test')->>'dup'")" true
check "重送後餘額仍為 100" "$("${DB[@]}" -c "SELECT gold FROM characters WHERE id='$A'")" 100
check "扣到負數整筆不生效" "$("${DB[@]}" -c "SELECT change_gold('req-gold-0002','$A',-500,'test')->>'err'")" insufficient_gold
check "扣款失敗後餘額不變" "$("${DB[@]}" -c "SELECT gold FROM characters WHERE id='$A'")" 100
check "直接把金幣改成負數被資料庫拒絕" "$("${DB[@]}" -c "UPDATE characters SET gold=-1 WHERE id='$A'" 2>&1 | grep -c 'violates check constraint')" 1
check "不合法 request_id 被拒" "$("${DB[@]}" -c "SELECT change_gold('x','$A',1,'t')" 2>&1 | grep -c 'violates check constraint')" 1

# 道具：UUID＋冪等轉移
I=$("${DB[@]}" -c "INSERT INTO items(owner_id, def_id, qty) VALUES ('$A','test_item',1) RETURNING uid")
check "轉移道具 A→B" "$("${DB[@]}" -c "SELECT transfer_item('req-item-0001','$A','$B','$I',1)->>'ok'")" true
check "同 request 重送回傳原結果、不重複轉移" "$("${DB[@]}" -c "SELECT transfer_item('req-item-0001','$A','$B','$I',1)->>'dup'")" true
check "A 已不是擁有者，不能再轉" "$("${DB[@]}" -c "SELECT transfer_item('req-item-0002','$A','$C','$I',2)->>'err'")" not_owner
check "舊版本號轉移被拒" "$("${DB[@]}" -c "SELECT transfer_item('req-item-0003','$B','$C','$I',1)->>'err'")" version_conflict

# 並行：同一道具同時送出 20 筆轉移（不同 request_id、不同接收者），只能有 1 筆成功
J=$("${DB[@]}" -c "INSERT INTO items(owner_id, def_id, qty) VALUES ('$B','race_item',1) RETURNING uid")
for i in $(seq -w 1 20); do
  ( "${DB[@]}" -c "SELECT transfer_item('req-race-00$i','$B', CASE WHEN $((10#$i)) % 2 = 0 THEN '$A'::uuid ELSE '$C'::uuid END,'$J',1)->>'ok'" > "$tmp/race$i" 2>&1 ) &
done
wait
ok=$(cat "$tmp"/race* | grep -c '^true$')
check "並行 20 筆轉移同一道具：成功筆數" "$ok" 1
check "道具異動紀錄只有 1 筆" "$("${DB[@]}" -c "SELECT count(*) FROM item_events WHERE item_uid='$J'")" 1
check "20 筆請求都有寫入 request_ledger" "$("${DB[@]}" -c "SELECT count(*) FROM request_ledger WHERE request_id LIKE 'req-race-%'")" 20

as_pg "$PGBIN/pg_ctl" -D "$tmp/data" stop -m fast >/dev/null
rm -rf "$tmp"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
