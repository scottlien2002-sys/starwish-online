# 怪物原始模型（使用者 2026-11-27 18:54 上傳；唯讀存檔，不修改）

這些是**還沒有綁骨架與遊戲動作的原始模型**，不直接放進遊戲。遊戲需要 Claude C 製作的骨架動畫版（HQ／Lite，各 7 組動畫：Idle、Move、Run、Attack、Hurt、Death、Respawn）。

| 檔案 | 怪物 | 內容 | 比對 |
|---|---|---|---|
| M002_MossHornBeast_TripoAutoRig_walk.glb | M002 苔角獸 | Tripo 自動綁骨（30 節點），只有 1 組動畫 `preset:quadruped:walk`（2.54 s）；沒壓縮 | 貼圖：苔蘚綠＋棕色角＋小白花 |
| M003_CloudFluffBird_original.glb | M003 雲絨鳥 | Tripo＋gltfpack 原始模型，沒有骨架 | 貼圖：白藍雲絨、葉子、橘花 |
| M004_WindfeatherFox_original.glb | M004 風羽狐 | 原始模型 | SHA-256 開頭 60fcaa64 ＝ Claude C M004 報告的備份原檔 |
| M005_NebulaSheep_original.glb | M005 星雲咩咩 | 原始模型 | 241ed7d5 ＝ C 的 M005 報告 |
| M006_CarrotKing_original.glb | M006 胡蘿蔔大王 | 原始模型 | a0b77c5c36700abc ＝ C 的 M006 報告 |
| M007_CrownHammerRabbit_original.glb | M007 王冠重錘兔 | 原始模型 | 7c22ddbb69097eda ＝ C 的 M007 報告 |

上傳時檔名的中文字被清掉，檔名依 SHA-256 與貼圖內容辨識後重新命名；位元組未改動（見 SHA256SUMS.txt）。

**下一步（使用者 2026-11-27 決定）**
- M004～M007：取得 Claude C 已完成的動畫版 GLB。
- M002、M003：請 Claude C 綁骨架、做 7 組動作。
- 放進 `public/models/monsters/m00X/`，並登記在 `manifest.json`，遊戲就會自動在對應區域出現。
