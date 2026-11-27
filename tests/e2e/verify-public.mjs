// 公開 GitHub Pages 網址實測（唯讀）：等 preview.json 換成指定 commit → 所有 JS／模型 200 → Chromium、WebKit（iPhone 尺寸）載入完整遊戲。
// 用法：node tests/e2e/verify-public.mjs <預覽網址（/ 結尾）> <commit> [逾時分鐘]
import { loadPlaywright } from "./static-server.mjs";

const base = process.argv[2];
const commit = process.argv[3];
const maxMin = Number(process.argv[4] ?? 20);
if (!base || !commit) {
  console.error("用法：node tests/e2e/verify-public.mjs <url/> <commit>");
  process.exit(2);
}
const t0 = Date.now();
let live = null;
while (Date.now() - t0 < maxMin * 60000) {
  try {
    const r = await fetch(`${base}preview.json?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (j.commit === commit) {
        live = j;
        break;
      }
      console.log(`preview.json 目前 ${j.commit?.slice(0, 8)}，等待 ${commit.slice(0, 8)}…`);
    } else console.log(`preview.json HTTP ${r.status}，等待發布…`);
  } catch (e) {
    console.log(`讀取失敗：${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
if (!live) {
  console.log(`FAIL：${maxMin} 分鐘內公開網址沒有更新到 ${commit}`);
  process.exit(1);
}
console.log(`公開網址已更新：${JSON.stringify(live)}（等待 ${Math.round((Date.now() - t0) / 1000)} 秒）`);
let fails = 0;
const html = await (await fetch(`${base}?t=${Date.now()}`, { cache: "no-store" })).text();
const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
const urls = [...assets.map((a) => new URL(a, base).href), ...["male", "female"].flatMap((g) => ["hq", "lite"].map((l) => `${base}models/novice_c10b5b_${g}_${l}.glb`)), `${base}models/village-p3/portals_hq.glb`, `${base}models/village-p3/portals_lite.glb`];
for (const u of urls) {
  const r = await fetch(u, { method: "GET", cache: "no-store" });
  if (!r.ok) {
    fails++;
    console.log(`✗ HTTP ${r.status} ${u}`);
  }
}
console.log(`${fails ? "✗" : "✓"} 資源 HTTP：${urls.length - fails}/${urls.length} 為 200`);
const pw = await loadPlaywright();
for (const [name, vp] of [["webkit", { width: 393, height: 852 }], ["chromium", { width: 852, height: 393 }]]) {
  const browser = await pw[name].launch();
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  const bad = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
  try {
    await page.goto(`${base}?play=world&newgame=1&lod=lite`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__starwishWorld?.ready === true && !!window.__starwishWorld.info().interact && /^(loaded|部分|error)/.test(window.__starwishWorld.info().art), null, { timeout: 300000 });
    const i = await page.evaluate(() => window.__starwishWorld.info());
    const am = i.avatarModel;
    const ok = i.map === "village" && i.art === "loaded" && errs.length === 0 && bad.length === 0 && am?.modular === false && /^novice_c10b5b_/.test(i.file) && (i.npcs?.ids.length ?? 0) >= 7 && i.npcs?.board && i.npcs?.merchant;
    if (!ok) fails++;
    console.log(`${ok ? "✓" : "✗"} ${name} ${vp.width}×${vp.height}：星芽村載入、美術 ${i.art}、角色 ${i.file}（骨骼 ${am?.bones}、三角形 ${am?.triangles}）、NPC ${i.npcs?.ids.length}＋洛恩 ${i.npcs?.merchant}＋佈告欄 ${i.npcs?.board}、錯誤 ${errs.length}、失敗請求 ${bad.length}`);
    for (const e of [...errs, ...bad]) console.log(`   ! ${e}`);
  } catch (e) {
    fails++;
    console.log(`✗ ${name}：${e.message}`);
  }
  // 畫面截圖（只在 WebKit 直向做一次）：星芽村、原野營地傳送陣、寵物在頭部側邊
  if (name === "webkit" && process.env.SHOTS_DIR) {
    try {
      const dir = process.env.SHOTS_DIR;
      await page.screenshot({ path: `${dir}/1_village_arrive.png` });
      await page.evaluate(() => window.__starwishWorld.toField());
      await page.waitForFunction(() => window.__starwishPlay?.ready === true && !!window.__starwishPlay.world, null, { timeout: 300000 });
      await page.waitForFunction(() => window.__starwishPlay.world.info().portal.built, null, { timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${dir}/2_field_camp_portal.png` });
      const id = await page.evaluate(() => {
        const api = window.__starwishPlay;
        api.pet.give("seed", 1);
        const pid = api.pet.hatch("seed");
        api.pet.timeWarp(60);
        api.pet.equip(pid);
        return pid;
      });
      await page.waitForTimeout(4000);
      const info = await page.evaluate(() => window.__starwishPlay.world.info());
      console.log(`寵物 #${id}：與頭部外緣間距 ${info.petGap?.toFixed(3)} m、頭部半寬 ${info.headHalfWidth?.toFixed(3)} m、寵物大小 ${info.followerSize}`);
      await page.screenshot({ path: `${dir}/3_field_pet.png` });
      await page.evaluate(() => window.__starwishPlay.teleport(-56, -65.2));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${dir}/4_field_portal_near.png` });
      // Stage 7.3：七種怪物所在區域（站在區域外緣）
      const zones = [["01_bobo", -24, -60], ["02_moss_horn_beast", -62, -39], ["03_cloud_fluff_bird", 14, -19], ["04_windfeather_fox", 52, 16], ["05_nebula_sheep", -44, 37], ["06_carrot_king", -12, 28], ["07_crown_hammer_rabbit", 0, 57]];
      for (const [label, x, z] of zones) {
        await page.evaluate(([x, z]) => { window.__starwishPlay.teleport(x, z); window.__starwishPlay.heal(); }, [x, z]);
        await page.waitForTimeout(3000);
        await page.screenshot({ path: `${dir}/6_zone_${label}.png` });
      }
      const pi = await page.evaluate(() => window.__starwishPlay.info());
      const kinds = {};
      for (const m of pi.monsters) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
      const zok = JSON.stringify(kinds) && kinds.moss_horn_beast === 5 && kinds.cloud_fluff_bird === 5 && kinds.windfeather_fox === 4 && kinds.nebula_sheep === 4 && kinds.carrot_king === 2 && kinds.crown_hammer_rabbit === 1 && kinds.star_dew_bobo === 6;
      if (!zok) fails++;
      console.log(`${zok ? "✓" : "✗"} 七種怪物：${JSON.stringify(kinds)}｜${pi.fieldMonsters.map((x) => x.status).join("／")}`);
      // 星露草坪：普通攻擊打星露啵啵（被動怪物，先打才反擊）
      await page.evaluate(() => window.__starwishPlay.teleport(-22, -52));
      await page.waitForTimeout(1500);
      for (let k = 0; k < 60; k++) {
        await page.evaluate(() => {
          const api = window.__starwishPlay;
          const i = api.info();
          if (i.hp < 40) api.heal();
          const m = i.monsters.find((x) => x.kind === "star_dew_bobo" && x.state !== "death" && x.state !== "dead" && x.hp > 0);
          if (m && Math.hypot(m.x - i.pos[0], m.z - i.pos[2]) > 1.2) api.teleport(m.x + 0.9, m.z);
          else api.press("attack");
        });
        await page.waitForTimeout(250);
        if (k === 4) await page.screenshot({ path: `${dir}/7_field_attack_fx.png` });
      }
      const fi = await page.evaluate(() => window.__starwishPlay.world.info());
      const cfx = (await page.evaluate(() => window.__starwishPlay.info())).combatFx;
      const fok = !!cfx && cfx.hitFx > 0 && cfx.damageShown > 0;
      if (!fok) fails++;
      console.log(`${fok ? "✓" : "✗"} 戰鬥：特效 ${JSON.stringify(cfx)}｜等級 ${fi.level}、經驗 ${fi.exp}（本次 +${fi.expGained}）`);
    } catch (e) {
      console.log(`截圖流程失敗：${e.message}`);
    }
  }
  await browser.close();
}
// Stage 7.2：女生新版初心者（WebKit 直向，高畫質）
if (process.env.SHOTS_DIR) {
  const browser = await pw.webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}?play=world&newgame=1&g=female&lod=hq`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__starwishWorld?.ready === true && !!window.__starwishWorld.info().interact, null, { timeout: 300000 });
    await page.waitForTimeout(3000);
    const i = await page.evaluate(() => window.__starwishWorld.info());
    console.log(`女生 HQ：角色 ${i.file}、三角形 ${i.avatarModel?.triangles}、NPC ${i.npcs?.ids.length}`);
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/8_village_female_hq.png` });
  } catch (e) {
    console.log(`女生截圖失敗：${e.message}`);
  }
  await browser.close();
}
// Stage 7.2：骨骼動畫怪物測試頁（Babylon.js 9 實際載入、自動檢查）
{
  const browser = await pw.webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  try {
    await page.goto(`${base}?lab=rigged&q=lite&count=6`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__starwishRigLab?.done === true, null, { timeout: 300000 });
    const r = await page.evaluate(() => ({ checks: window.__starwishRigLab.checks, spec: window.__starwishRigLab.spec }));
    const bad = r.checks.filter((c) => !c.ok);
    if (bad.length || errs.length) fails++;
    console.log(`${bad.length || errs.length ? "✗" : "✓"} 骨骼動畫測試頁（${r.spec.fixture ? "接口測試替身" : "M004"}）：${r.checks.length - bad.length}/${r.checks.length} 項通過、錯誤 ${errs.length}`);
    for (const c of bad) console.log(`   ✗ ${c.name}`);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/5_rigged_lab.png` });
  } catch (e) {
    fails++;
    console.log(`✗ 骨骼動畫測試頁：${e.message}`);
  }
  await browser.close();
}
console.log(fails ? `公開網址驗證失敗：${fails}` : "公開網址驗證通過");
process.exit(fails ? 1 : 0);
