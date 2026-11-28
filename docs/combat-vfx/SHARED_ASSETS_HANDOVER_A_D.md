# C → A／D 共用資產交接清單（Combat VFX）

日期：2026-11-28　作者：Claude C　依據：`claude/Starwish_Shared_Assets_Spec.md`
gh-pages 基準：`1977d78`（C 最後一次部署）；之後只有 A 的 `d86bc03`（stage75-novice），C 沒有再改動。
C 部署目前**暫停**（`feature/combat-vfx-stage3` 的 `.github/cvfx-deploy-hold`），等 A 確認解除。

## 1. 給 D：mp81／mp82 引用的 12 個 C 檔案

這 12 個檔案已經有**內容完全相同**的副本在共用區。D 只要把 `asset-remap.json` 的目標從 `../preview-combat-vfx/…` 改成下表的共用路徑，畫面不會有任何變化。改完後下一次 D 部署，C 的 Stage 1 資料夾就不再被綁住。

| 原路徑（preview-combat-vfx/） | 大小 | SHA-1 | 共用區路徑（相對 Pages 根目錄） | 使用方 |
|---|---|---|---|---|
| `models/monsters/m004/M004_WindfeatherFox_Rig_V1_1_HQ.glb` | 3.80 MB | `229e4ae4b971f425ca975ea69ce95be60a975b71` | `shared-assets/v1/22/229e4ae4b971f425ca975ea69ce95be60a975b71.glb` | mp82 |
| `models/monsters/m004/M004_WindfeatherFox_Rig_V1_1_Lite.glb` | 0.79 MB | `0ddb81e292b95319f6653c9f7e05a779f7769b95` | `shared-assets/v1/0d/0ddb81e292b95319f6653c9f7e05a779f7769b95.glb` | mp82 |
| `models/monsters/m005/M005_NebulaSheep_Rig_V1_HQ.glb` | 3.35 MB | `919123953a8804e39d583469736209a2b7b61928` | `shared-assets/v1/91/919123953a8804e39d583469736209a2b7b61928.glb` | mp82 |
| `models/monsters/m005/M005_NebulaSheep_Rig_V1_Lite.glb` | 0.67 MB | `b6e235fc9173a946306645fa99cb2a29461cc5e2` | `shared-assets/v1/b6/b6e235fc9173a946306645fa99cb2a29461cc5e2.glb` | mp82 |
| `models/monsters/m006/M006_CarrotKing_Rig_V1_HQ.glb` | 3.71 MB | `4b0d338eff8cb54741a11dabd87d5321ee00a54d` | `shared-assets/v1/4b/4b0d338eff8cb54741a11dabd87d5321ee00a54d.glb` | mp82 |
| `models/monsters/m006/M006_CarrotKing_Rig_V1_Lite.glb` | 0.76 MB | `4c45b24c14a7bd664573b1de72e8947c850c9ba5` | `shared-assets/v1/4c/4c45b24c14a7bd664573b1de72e8947c850c9ba5.glb` | mp82 |
| `models/monsters/m007/M007_CrownHammerRabbit_Rig_V1_HQ.glb` | 3.83 MB | `d9a42b008a8a582803427d57d38ebdea79ca6a0d` | `shared-assets/v1/d9/d9a42b008a8a582803427d57d38ebdea79ca6a0d.glb` | mp82 |
| `models/monsters/m007/M007_CrownHammerRabbit_Rig_V1_Lite.glb` | 0.79 MB | `a35c37164de3715f72a911713c6e3211204e5ade` | `shared-assets/v1/a3/a35c37164de3715f72a911713c6e3211204e5ade.glb` | mp82 |
| `models/novice_c10b5b_female_hq.glb` | 6.95 MB | `91e095b457c4d6e5bde91267e9c03573762e3a98` | `shared-assets/v1/91/91e095b457c4d6e5bde91267e9c03573762e3a98.glb` | mp81、mp82 |
| `models/novice_c10b5b_female_lite.glb` | 1.70 MB | `9245d7801570a6f3b44f11446aa2c70c0c1c5a9c` | `shared-assets/v1/92/9245d7801570a6f3b44f11446aa2c70c0c1c5a9c.glb` | mp81、mp82 |
| `models/novice_c10b5b_male_hq.glb` | 7.01 MB | `1d7777b5f502d7d9645444b0cacaaf2460298867` | `shared-assets/v1/1d/1d7777b5f502d7d9645444b0cacaaf2460298867.glb` | mp81、mp82 |
| `models/novice_c10b5b_male_lite.glb` | 1.76 MB | `4f4947e0778044ef0cade4aae861abed4ab7fff3` | `shared-assets/v1/4f/4f4947e0778044ef0cade4aae861abed4ab7fff3.glb` | mp81、mp82 |

在 mp81／mp82 的資料夾內，相對路徑就是 `../` 加上共用區路徑。12 個檔案都已用目前 gh-pages 逐一算過 SHA-1，與共用區檔名一致。

**相容性保證（C 端）**
- 在 D 改指向之前，C 不會刪除、改名或改內容這 12 個檔案。部署流程的 `preserve-save／restore` 會保留它們，`publish` 也不會搬走仍被引用的檔案。
- 角色 C1.0-B5b 與 M004～M007 Rig 的檔案內容不會更新。新版角色（A 的 Tripo 男性初心者）是新檔名、新雜湊，舊引用不受影響。

## 2. C 三個預覽目前的共用資產

| 預覽 | 原路徑 | 版本 | 大小 | 共用區路徑 | 引用數 |
|---|---|---|---|---|---|
| combat-vfx-s3 | `models/monsters/m002/M002_MossHornBeast_Rig_V1_HQ.glb` | Rig V1.1（Stage 3） | 2.52 MB | `shared-assets/v1/fd/fdedd1d27619b7436bf514e9ea9bde0756974bb7.glb` | 1 |
| combat-vfx-s3 | `models/monsters/m002/M002_MossHornBeast_Rig_V1_Lite.glb` | Rig V1.1（Stage 3） | 0.72 MB | `shared-assets/v1/fd/fd5bbcba1515bab5112227727f3d17f1fa614562.glb` | 1 |
| combat-vfx-s3 | `models/monsters/m003/M003_CloudFluffBird_Rig_V1_HQ.glb` | Rig V1.1（Stage 3） | 3.40 MB | `shared-assets/v1/10/106faec11034796fc0e382c6f96c722da56d528f.glb` | 1 |
| combat-vfx-s3 | `models/monsters/m003/M003_CloudFluffBird_Rig_V1_Lite.glb` | Rig V1.1（Stage 3） | 0.66 MB | `shared-assets/v1/b6/b6058db71f818afbd9f27aa477d21d8cfb08e685.glb` | 1 |
| combat-vfx-s3 | `models/monsters/m004/M004_WindfeatherFox_Rig_V1_1_HQ.glb` | Rig V1.1 | 3.80 MB | `shared-assets/v1/22/229e4ae4b971f425ca975ea69ce95be60a975b71.glb` | 5 |
| combat-vfx-s3 | `models/monsters/m004/M004_WindfeatherFox_Rig_V1_1_Lite.glb` | Rig V1.1 | 0.79 MB | `shared-assets/v1/0d/0ddb81e292b95319f6653c9f7e05a779f7769b95.glb` | 5 |
| combat-vfx-s3 | `models/monsters/m005/M005_NebulaSheep_Rig_V1_HQ.glb` | Rig V1 | 3.35 MB | `shared-assets/v1/91/919123953a8804e39d583469736209a2b7b61928.glb` | 5 |
| combat-vfx-s3 | `models/monsters/m005/M005_NebulaSheep_Rig_V1_Lite.glb` | Rig V1 | 0.67 MB | `shared-assets/v1/b6/b6e235fc9173a946306645fa99cb2a29461cc5e2.glb` | 5 |
| combat-vfx-s3 | `models/monsters/m006/M006_CarrotKing_Rig_V1_HQ.glb` | Rig V1 | 3.71 MB | `shared-assets/v1/4b/4b0d338eff8cb54741a11dabd87d5321ee00a54d.glb` | 5 |
| combat-vfx-s3 | `models/monsters/m006/M006_CarrotKing_Rig_V1_Lite.glb` | Rig V1 | 0.76 MB | `shared-assets/v1/4c/4c45b24c14a7bd664573b1de72e8947c850c9ba5.glb` | 5 |
| combat-vfx-s3 | `models/monsters/m007/M007_CrownHammerRabbit_Rig_V1_HQ.glb` | Rig V1 | 3.83 MB | `shared-assets/v1/d9/d9a42b008a8a582803427d57d38ebdea79ca6a0d.glb` | 5 |
| combat-vfx-s3 | `models/monsters/m007/M007_CrownHammerRabbit_Rig_V1_Lite.glb` | Rig V1 | 0.79 MB | `shared-assets/v1/a3/a35c37164de3715f72a911713c6e3211204e5ade.glb` | 5 |
| combat-vfx-s3 | `models/novice_c10b5b_female_hq.glb` | C1.0-B5b（已驗收，未改） | 6.95 MB | `shared-assets/v1/91/91e095b457c4d6e5bde91267e9c03573762e3a98.glb` | 5 |
| combat-vfx-s3 | `models/novice_c10b5b_female_lite.glb` | C1.0-B5b（已驗收，未改） | 1.70 MB | `shared-assets/v1/92/9245d7801570a6f3b44f11446aa2c70c0c1c5a9c.glb` | 5 |
| combat-vfx-s3 | `models/novice_c10b5b_female_remote.glb` | remote 近＋遠 LOD（Stage 3） | 1.83 MB | `shared-assets/v1/f6/f625215a0bd85533e1ed4f35d7e8adf50289f2d3.glb` | 1 |
| combat-vfx-s3 | `models/novice_c10b5b_male_hq.glb` | C1.0-B5b（已驗收，未改） | 7.01 MB | `shared-assets/v1/1d/1d7777b5f502d7d9645444b0cacaaf2460298867.glb` | 5 |
| combat-vfx-s3 | `models/novice_c10b5b_male_lite.glb` | C1.0-B5b（已驗收，未改） | 1.76 MB | `shared-assets/v1/4f/4f4947e0778044ef0cade4aae861abed4ab7fff3.glb` | 5 |
| combat-vfx-s3 | `models/novice_c10b5b_male_remote.glb` | remote 近＋遠 LOD（Stage 3） | 1.89 MB | `shared-assets/v1/41/41a83c9173112a18d936a6cbe4d6ac8653160113.glb` | 1 |
| combat-vfx-s2 | `models/monsters/m002/M002_MossHornBeast_Rig_V1_HQ.glb` | Rig V1.1（Stage 3） | 2.52 MB | `shared-assets/v1/9b/9b5ca3138fae947049c55d6b79dc4ff5ed394e0e.glb` | 4 |
| combat-vfx-s2 | `models/monsters/m002/M002_MossHornBeast_Rig_V1_Lite.glb` | Rig V1.1（Stage 3） | 0.72 MB | `shared-assets/v1/bc/bc26d9e68c3c05b29d0bc26316e2e3b33d29be5b.glb` | 4 |
| combat-vfx-s2 | `models/monsters/m003/M003_CloudFluffBird_Rig_V1_HQ.glb` | Rig V1.1（Stage 3） | 3.40 MB | `shared-assets/v1/c8/c820d79bb740fec6110869bccb2ea3735686d345.glb` | 4 |
| combat-vfx-s2 | `models/monsters/m003/M003_CloudFluffBird_Rig_V1_Lite.glb` | Rig V1.1（Stage 3） | 0.66 MB | `shared-assets/v1/5f/5fcca9f207f2b0b076752e747531638a4a6a18c0.glb` | 4 |
| combat-vfx-s2 | `models/monsters/m004/M004_WindfeatherFox_Rig_V1_1_HQ.glb` | Rig V1.1 | 3.80 MB | `shared-assets/v1/22/229e4ae4b971f425ca975ea69ce95be60a975b71.glb` | 5 |
| combat-vfx-s2 | `models/monsters/m004/M004_WindfeatherFox_Rig_V1_1_Lite.glb` | Rig V1.1 | 0.79 MB | `shared-assets/v1/0d/0ddb81e292b95319f6653c9f7e05a779f7769b95.glb` | 5 |
| combat-vfx-s2 | `models/monsters/m005/M005_NebulaSheep_Rig_V1_HQ.glb` | Rig V1 | 3.35 MB | `shared-assets/v1/91/919123953a8804e39d583469736209a2b7b61928.glb` | 5 |
| combat-vfx-s2 | `models/monsters/m005/M005_NebulaSheep_Rig_V1_Lite.glb` | Rig V1 | 0.67 MB | `shared-assets/v1/b6/b6e235fc9173a946306645fa99cb2a29461cc5e2.glb` | 5 |
| combat-vfx-s2 | `models/monsters/m006/M006_CarrotKing_Rig_V1_HQ.glb` | Rig V1 | 3.71 MB | `shared-assets/v1/4b/4b0d338eff8cb54741a11dabd87d5321ee00a54d.glb` | 5 |
| combat-vfx-s2 | `models/monsters/m006/M006_CarrotKing_Rig_V1_Lite.glb` | Rig V1 | 0.76 MB | `shared-assets/v1/4c/4c45b24c14a7bd664573b1de72e8947c850c9ba5.glb` | 5 |
| combat-vfx-s2 | `models/monsters/m007/M007_CrownHammerRabbit_Rig_V1_HQ.glb` | Rig V1 | 3.83 MB | `shared-assets/v1/d9/d9a42b008a8a582803427d57d38ebdea79ca6a0d.glb` | 5 |
| combat-vfx-s2 | `models/monsters/m007/M007_CrownHammerRabbit_Rig_V1_Lite.glb` | Rig V1 | 0.79 MB | `shared-assets/v1/a3/a35c37164de3715f72a911713c6e3211204e5ade.glb` | 5 |
| combat-vfx-s2 | `models/novice_c10b5b_female_hq.glb` | C1.0-B5b（已驗收，未改） | 6.95 MB | `shared-assets/v1/91/91e095b457c4d6e5bde91267e9c03573762e3a98.glb` | 5 |
| combat-vfx-s2 | `models/novice_c10b5b_female_lite.glb` | C1.0-B5b（已驗收，未改） | 1.70 MB | `shared-assets/v1/92/9245d7801570a6f3b44f11446aa2c70c0c1c5a9c.glb` | 5 |
| combat-vfx-s2 | `models/novice_c10b5b_female_remote.glb` | remote 近＋遠 LOD（Stage 3） | 1.73 MB | `shared-assets/v1/86/86dd610fcb5fedefbc84c46105fd0c1c71f7b859.glb` | 4 |
| combat-vfx-s2 | `models/novice_c10b5b_male_hq.glb` | C1.0-B5b（已驗收，未改） | 7.01 MB | `shared-assets/v1/1d/1d7777b5f502d7d9645444b0cacaaf2460298867.glb` | 5 |
| combat-vfx-s2 | `models/novice_c10b5b_male_lite.glb` | C1.0-B5b（已驗收，未改） | 1.76 MB | `shared-assets/v1/4f/4f4947e0778044ef0cade4aae861abed4ab7fff3.glb` | 5 |
| combat-vfx-s2 | `models/novice_c10b5b_male_remote.glb` | remote 近＋遠 LOD（Stage 3） | 1.79 MB | `shared-assets/v1/a5/a512c81995a6e9f74ade07094a4cc567f315848c.glb` | 4 |

- Stage 1（preview-combat-vfx）目前 0 個改讀共用區：它的大型檔案全部被 D 引用，依規格暫留原處。
- 「引用數」是 `shared-assets/index.json` 的 users 數，包含 A 的 stage73／74 與 C 的 s2／s3。
- C 新放入共用區的 6 個檔案：M002／M003 Rig V1.1 的 HQ／Lite，以及 Stage 3 remote 男女。其他都與既有內容相同，沒有重複存放。

## 3. 依賴關係（目前）

| 來源 | 使用方 |
|---|---|
| preview-combat-vfx（12 檔，上表） | preview-mp81（4）、preview-mp82（12） |
| /shared-assets/（C 的 18＋18 個連結） | preview-combat-vfx-s2、preview-combat-vfx-s3 |
| preview-combat-vfx-s2／-s3 | 無人依賴 |

## 4. 版本與還原
- 接入前完整 Pages：`backup/gh-pages-20261128-pre-c-shared-assets`（`89281e2`）。
- 分支：Stage 1 `c54f300`、Stage 2 `71654b4`、Stage 3 `feature/combat-vfx-stage3`。接入前的版本保留在 `backup/combat-vfx-stage1-final`、`backup/combat-vfx-stage2-final`、`backup/combat-vfx-stage3-pre-shared-assets`。
- 驗證：`results/combat-vfx-pages-46104110365`（C s1／s2／s3、D mp81／mp82、A stage73／74 全部 200，雜湊一致）。
- 恢復 C 部署：A 確認後刪除 `.github/cvfx-deploy-hold`。
