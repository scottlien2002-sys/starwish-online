/**
 * 共用資產相容性：Claude D 的 mp81／mp82 引用的 12 個 C 檔案（角色 C1.0-B5b、M004～M007 Rig），
 * 內容必須與 gh-pages／shared-assets 上的雜湊一致。改了這些檔案就會讓 D 的預覽讀到不同內容 → 測試失敗。
 * 新版角色或怪物請用新檔名（新雜湊），不要覆蓋這些檔案。清單：docs/combat-vfx/SHARED_ASSETS_HANDOVER_A_D.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const D_REFERENCED: [string, string][] = [
  ["models/monsters/m004/M004_WindfeatherFox_Rig_V1_1_HQ.glb", "229e4ae4b971f425ca975ea69ce95be60a975b71"],
  ["models/monsters/m004/M004_WindfeatherFox_Rig_V1_1_Lite.glb", "0ddb81e292b95319f6653c9f7e05a779f7769b95"],
  ["models/monsters/m005/M005_NebulaSheep_Rig_V1_HQ.glb", "919123953a8804e39d583469736209a2b7b61928"],
  ["models/monsters/m005/M005_NebulaSheep_Rig_V1_Lite.glb", "b6e235fc9173a946306645fa99cb2a29461cc5e2"],
  ["models/monsters/m006/M006_CarrotKing_Rig_V1_HQ.glb", "4b0d338eff8cb54741a11dabd87d5321ee00a54d"],
  ["models/monsters/m006/M006_CarrotKing_Rig_V1_Lite.glb", "4c45b24c14a7bd664573b1de72e8947c850c9ba5"],
  ["models/monsters/m007/M007_CrownHammerRabbit_Rig_V1_HQ.glb", "d9a42b008a8a582803427d57d38ebdea79ca6a0d"],
  ["models/monsters/m007/M007_CrownHammerRabbit_Rig_V1_Lite.glb", "a35c37164de3715f72a911713c6e3211204e5ade"],
  ["models/novice_c10b5b_female_hq.glb", "91e095b457c4d6e5bde91267e9c03573762e3a98"],
  ["models/novice_c10b5b_female_lite.glb", "9245d7801570a6f3b44f11446aa2c70c0c1c5a9c"],
  ["models/novice_c10b5b_male_hq.glb", "1d7777b5f502d7d9645444b0cacaaf2460298867"],
  ["models/novice_c10b5b_male_lite.glb", "4f4947e0778044ef0cade4aae861abed4ab7fff3"],
];

test("共用資產：D 引用的 12 個 C 檔案內容不變（SHA-1 與 shared-assets 一致）", () => {
  assert.equal(D_REFERENCED.length, 12);
  for (const [rel, sha] of D_REFERENCED) {
    const h = createHash("sha1").update(readFileSync(new URL(`../../public/${rel}`, import.meta.url))).digest("hex");
    assert.equal(h, sha, rel);
  }
});

test("共用資產：一般建置的 asset-remap.json 是空清單（本機不受影響）", () => {
  const m = JSON.parse(readFileSync(new URL("../../public/asset-remap.json", import.meta.url), "utf8")) as { files: Record<string, string> };
  assert.deepEqual(m.files, {});
});
