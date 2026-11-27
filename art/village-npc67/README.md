# Stage 6.7｜Tripo 正式 NPC 資產流程（Claude B）

原始檔：`source/*.glb`（使用者提供的 Tripo 模型，SHA-256 在 `source/SOURCES.json`，不修改）。
輸出：`public/models/village-npc67/`（`npc_<key>67_{hq,lite,far}.glb`、`pet_merchant67_{hq,lite,far}.glb`、`board67_{hq,lite}.glb`、`stats67.json`、`qa67.json`）。

1. `tools/meshopt_py.py`：讀取 Tripo GLB（EXT_meshopt_compression：頂點／索引解碼＋EXPONENTIAL 濾波），以 accessor 範圍與索引驗證。
2. `tools/export_obj.py`：面向 +X → +Z、Y 上；依頭頂（不含帽子、武器）縮放到目標身高；身體範圍最低點＝腳底 0 → `mesh/*.obj`。
3. CI `blender-village-npc67.yml`（`decimate.py`）：只做靜態網格減面（Lite 約 5,000、遠距約 2,000；佈告欄 5,000／2,500）→ `art-village-npc67-dec`。
4. `tools/build67.py`：骨架（18 根，靜止旋轉為單位）＋權重（`rig67.compute_weights`：軀幹分段、手臂鏈、武器剛體綁手、腿鏈＋腳底；鄰接平滑；每頂點 ≤4 骨）＋動作（`anim67.py`：Idle／Talk／Turn／Act；洛恩 Walk 為矢狀面兩骨 IK，支撐期腳底相對身體以 0.6 m/s 後移）→ GLB。HQ／Lite／遠距用同一套骨架、權重規則與動作。
5. 檢查：`glbread.py` 獨立讀回 GLB 做蒙皮；`qa_mm.py`（每個動作的邊長變化、臉部變形、最低點）→ `qa67.json`；`qa_walk.py`（支撐期腳底滑動）；`sheet_npc.py`（綁定姿勢 vs 原始網格、各動作抽格圖）。
各 NPC 的骨架位置與動作在 `tools/cfgs.py`、`tools/cfg_merchant.py`。工具腳本內的路徑以 /home/claude 開發環境為準。
