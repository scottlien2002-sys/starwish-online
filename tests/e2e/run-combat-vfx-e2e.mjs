// Combat VFX Lab E2E（Claude C）：?lab=combat 在 Chromium／WebKit 實際載入與操作。
// 檢查：載入（男女 C1.0-B5b、M004～M007 骨骼動畫怪物）、6 個技能逐一施放（動作／特效／傷害同一格同步）、
// 三段特效品質、攻速 160 上限、多人模擬預算、沒有頁面錯誤。FPS 是 CI 軟體繪圖的數字，不代表 iPhone。
// 用法：node tests/e2e/run-combat-vfx-e2e.mjs dist [chromium,webkit]
import { mkdirSync, writeFileSync } from "node:fs";
import { loadPlaywright, serve } from "./static-server.mjs";

const distDir = process.argv[2] ?? "dist";
const browsers = (process.argv[3] ?? "chromium,webkit").split(",");
// 第 2 個參數是 http(s) 網址時：直接測公開網址（GitHub Pages），只跑指定的案例
const remote = /^https?:\/\//.test(distDir);
const onlyCases = (process.env.CVFX_CASES ?? "").split(",").filter(Boolean);
const outDir = new URL(`../../test-results/${remote ? "combat-vfx-public" : "combat-vfx"}/`, import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const pw = await loadPlaywright();
const server = remote ? { url: distDir.replace(/\/$/, ""), close: async () => {} } : await serve(distDir);
const report = { startedAt: new Date().toISOString(), note: "FPS 為 CI 軟體繪圖（無 GPU）數字，不代表 iPhone 效能", runs: [] };
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SKILLS = ["triple_slash", "staff_cast", "leap_slam", "whirlwind", "star_meteor", "charge_burst"];
const HIT_SHOT_DELAY = { triple_slash: 0, staff_cast: 0, leap_slam: 0, whirlwind: 0, star_meteor: 0, charge_burst: 0 };

for (const name of browsers) {
  const browser = await pw[name].launch({ args: name === "chromium" ? ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] : [] });
  for (const tcase of [
    { id: "male-medium", url: "?lab=combat&q=medium&g=male&mute=1" },
    { id: "female-high", url: "?lab=combat&q=high&g=female&mute=1" },
    { id: "low-multi8", url: "?lab=combat&q=low&g=male&mute=1&multi=8" },
    { id: "meadow-high", url: "?lab=combat&q=high&g=female&mute=1&env=meadow" },
    { id: "rules", url: "?lab=combat&q=low&g=male&mute=1" },
    { id: "perf", url: "?lab=combat&q=medium&g=male&mute=1" },
    { id: "audio", url: "?lab=combat&q=low&g=male&mute=1&ai=0" },
    // 手機介面：直向／橫向、Safe Area、開發者選單、縮放、統計數字（iPhone 實機回報的問題）
    { id: "ui-portrait", url: "?lab=combat&q=low&g=male&mute=1&ai=0", viewport: { width: 390, height: 844 } },
    { id: "ui-landscape", url: "?lab=combat&q=low&g=female&mute=1&ai=0", viewport: { width: 844, height: 390 } },
    // 固定步長：每 1/30 秒截一張，得到真正 30 fps 的展示畫面序列（CI 沒 GPU，即時播放只有 3～5 FPS 看不出特效）
    { id: "showcase", url: "?lab=combat&q=high&g=male&mute=1&manual=1&ai=0" },
    { id: "showcase-meadow", url: "?lab=combat&q=high&g=female&mute=1&manual=1&ai=0&env=meadow" },
  ]) {
    if ((tcase.id.startsWith("showcase") || tcase.id === "perf") && (remote || name !== "chromium")) continue;
    if (!onlyCases.length && name === "webkit" && (tcase.id === "meadow-high" || tcase.id === "rules")) continue;
    if (onlyCases.length && !onlyCases.includes(tcase.id)) continue;
    if (!onlyCases.length && name === "webkit" && tcase.id === "female-high") continue; // WebKit 跑兩組即可（時間）
    const run = { browser: name, case: tcase.id, checks: {}, errors: [], results: {} };
    const check = (k, ok, detail) => {
      run.checks[k] = { ok: !!ok, detail };
      if (!ok) failures++;
    };
    const ctx = await browser.newContext({ viewport: tcase.viewport ?? { width: 932, height: 430 }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && run.errors.push(`console: ${m.text()}`));
    const shot = (l) => page.screenshot({ path: `${outDir}${name}_${tcase.id}_${l}.png` }).catch(() => {});
    try {
      const t0 = Date.now();
      await page.goto(`${server.url}/${tcase.url}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__cvfx?.ready === true, null, { timeout: 300000 });
      run.results.loadMs = Date.now() - t0;
      await sleep(1500);
      let st = await page.evaluate(() => window.__cvfx.stats());
      run.results.loaded = st;
      check("載入：6 隻骨骼動畫怪物（M002～M007）且檔案檢查通過", st.monsters.length === 6 && st.monsters.every((m) => m.check?.ok), st.monsters.map((m) => ({ l: m.label, ok: m.check?.ok, e: m.check?.errors })));
      check("載入：初心者 C1.0-B5b（非 Tripo 組裝）", st.triangles > 5000, { triangles: st.triangles, gender: st.gender });
      await shot("00_loaded");

      if (tcase.id.startsWith("showcase")) {
        const dir = `${outDir}${tcase.id}/`;
        mkdirSync(dir, { recursive: true });
        const list = SKILLS;
        let fi = 0;
        const frameShot = () => page.screenshot({ path: `${dir}f${String(fi++).padStart(4, "0")}.jpg`, type: "jpeg", quality: 82 });
        const seq = [];
        for (const sk of list) {
          await page.evaluate(() => {
            const s = window.__cvfx.stats();
            const m = s.monsters.find((x) => x.state === "idle") ?? s.monsters[0];
            const dx = -m.pos[0], dz = -m.pos[1];
            const L = Math.hypot(dx, dz) || 1;
            window.__cvfx.moveTo(m.pos[0] + (dx / L) * 1.6, m.pos[1] + (dz / L) * 1.6);
          });
          await page.evaluate(() => window.__cvfx.view(1.15, 5.2));
          await page.evaluate(() => window.__cvfx.advance(0.5));
          const n0 = await page.evaluate(() => window.__cvfx.sync.length);
          const ok = await page.evaluate((id) => window.__cvfx.cast(id), sk);
          const start = fi;
          const dbg = [];
          for (let k = 0; k < 150; k++) {
            await page.evaluate(() => window.__cvfx.advance(1 / 30));
            await frameShot();
            if (k % 6 === 3) dbg.push({ k, fx: await page.evaluate(() => window.__cvfx.debugFx()) });
            const busy = await page.evaluate(() => window.__cvfx.busy());
            if (!busy && k > 20) break;
          }
          for (let k = 0; k < 18; k++) {
            await page.evaluate(() => window.__cvfx.advance(1 / 30));
            await frameShot();
          }
          const recs = await page.evaluate((n) => window.__cvfx.sync.slice(n), n0);
          seq.push({ skill: sk, cast: ok, frames: [start, fi - 1], hits: recs.length, dbg });
          check(`展示 ${sk}：固定步長下命中結算`, ok && recs.length > 0, recs.length);
          check(`展示 ${sk}：固定步長下命中格動作時間＝時間軸`, recs.every((r) => r.kind === "projectile" || Math.abs(r.animT - r.clipT) <= 1 / 60 + 0.002), recs.map((r) => [r.hit, r.clipT, r.animT]));
        }
        // 六大職業特效展示（只有畫面）：站在場中央，每個職業 1.6 秒
        if (tcase.id === "showcase") {
          const cdir = `${outDir}${tcase.id}-classes/`;
          mkdirSync(cdir, { recursive: true });
          let ci = 0;
          await page.evaluate(() => { window.__cvfx.moveTo(-1.0, 1.5); window.__cvfx.setYaw(0.6); window.__cvfx.view(1.2, 5.6); });
          for (const cls of await page.evaluate(() => window.__cvfx.classes)) {
            const ok = await page.evaluate((c) => window.__cvfx.classDemo(c), cls);
            check(`職業特效展示 ${cls}`, ok, null);
            for (let k = 0; k < 48; k++) {
              await page.evaluate(() => window.__cvfx.advance(1 / 30));
              await page.screenshot({ path: `${cdir}f${String(ci++).padStart(4, "0")}.jpg`, type: "jpeg", quality: 82 });
            }
          }
        }
        run.results.showcase = seq;
      } else if (tcase.id === "rules") {
        // 1) 被動怪（M002 Lv3）：玩家靠近 3 秒不會攻擊；被打之後反擊
        const pm = st.monsters.find((m) => m.level <= 4);
        await page.evaluate((m) => { window.__cvfx.moveTo(m.pos[0] * 0.72, m.pos[1] * 0.72); }, pm);
        await sleep(3500);
        let s2 = await page.evaluate(() => window.__cvfx.stats());
        const p0 = s2.monsters.find((m) => m.idx === pm.idx);
        check("規則：Lv1～4 被動怪，玩家靠近不主動攻擊", p0.behaviour === "passive" && p0.state !== "attack" && p0.angry === 0, p0);
        await page.evaluate((i) => window.__cvfx.targetMonster(i), pm.idx);
        await page.evaluate(() => window.__cvfx.cast("triple_slash"));
        await page.waitForFunction(() => !window.__cvfx.busy(), null, { timeout: 30000 }).catch(() => {});
        let retaliated = false;
        for (let k = 0; k < 40 && !retaliated; k++) {
          await sleep(250);
          s2 = await page.evaluate(() => window.__cvfx.stats());
          const m = s2.monsters.find((x) => x.idx === pm.idx);
          retaliated = m.angry > 0 && (m.state === "attack" || m.moving || m.state === "dead");
        }
        check("規則：被動怪被打之後反擊（仇恨狀態、追擊或攻擊）", retaliated, s2.monsters.find((x) => x.idx === pm.idx));
        // 2) 主動怪（Lv5 以上）：玩家進入警戒範圍就追擊
        const am = s2.monsters.find((m) => m.level >= 5 && m.level < 10 && m.state !== "dead");
        await page.evaluate((m) => { window.__cvfx.moveTo(m.home[0] * 0.55, m.home[1] * 0.55); }, am);
        let chased = false;
        for (let k = 0; k < 40 && !chased; k++) {
          await sleep(250);
          const s3 = await page.evaluate(() => window.__cvfx.stats());
          const m = s3.monsters.find((x) => x.idx === am.idx);
          chased = m.moving || m.state === "attack";
        }
        check("規則：Lv5 以上主動怪，玩家進入警戒範圍就追擊／攻擊", chased, am.label);
        // 3) 地形：面向岩石施放跳斬（前進 1.2 m），會停在岩石前、不穿過
        await page.evaluate(() => window.__cvfx.setMonsterAI(false));
        const rock = await page.evaluate(() => window.__cvfx.rocks[0]);
        const sx = rock.x - (rock.r + 0.9), sz = rock.z;
        await page.evaluate(([x, z]) => { window.__cvfx.moveTo(x, z); }, [sx, sz]);
        await sleep(300);
        await page.evaluate(() => window.__cvfx.setYaw(Math.PI / 2));
        // 用目前朝向施放（+X 指向岩石），不自動轉向怪物
        await page.evaluate(() => window.__cvfx.castNoFace("leap_slam"));
        await page.waitForFunction(() => !window.__cvfx.busy(), null, { timeout: 30000 }).catch(() => {});
        const after = await page.evaluate(() => ({ p: window.__cvfx.stats().player, b: window.__cvfx.blocked() }));
        const dist = Math.hypot(after.p.x - rock.x, after.p.z - rock.z);
        check("規則：技能不能穿越不可通行地形（跳斬被岩石擋下）", after.b === true && dist >= rock.r + 0.3 - 0.02, { after, rock, dist });
        await page.evaluate(() => window.__cvfx.setMonsterAI(true));
      } else if (tcase.id.startsWith("ui-")) {
        const vp = tcase.viewport;
        // 模擬 iPhone 瀏海／Home 指示條的 Safe Area（直向：上 47、下 34；橫向：左右 47、下 21）
        const safe = vp.height > vp.width ? { l: 0, r: 0, t: 47, b: 34 } : { l: 47, r: 47, t: 0, b: 21 };
        const layout = async () => page.evaluate((sf) => {
          const hud = document.querySelector(".cv-hud");
          for (const [k, v] of Object.entries({ "--sl": sf.l, "--sr": sf.r, "--st": sf.t, "--sb": sf.b })) hud.style.setProperty(k, `${v}px`);
          const R = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, vis: getComputedStyle(el).display !== "none" && r.width > 0 }; };
          const q = (s) => [...document.querySelectorAll(s)];
          return {
            W: innerWidth, H: innerHeight,
            perf: R(q(".cv-perf")[0]), dev: R(q(".cv-devbtn")[0]), menu: R(q(".cv-dev")[0]), target: R(q(".cv-target")[0]), zoom: R(q(".cv-zoom")[0]), joy: R(q(".cv-joy")[0]),
            skills: q(".cv-skill").map(R), menuButtons: q(".cv-dev .cv-btn").map(R),
            perfText: q(".cv-perf")[0].textContent, jumpButtons: q("button").filter((b) => /跳躍|jump/i.test(b.textContent) && !b.classList.contains("cv-skill")).length,
            outsideDev: q(".cv-hud button").filter((b) => !b.closest(".cv-dev") && !b.closest(".cv-skills") && !b.closest(".cv-zoom") && !b.classList.contains("cv-devbtn")).length,
          };
        }, safe);
        await sleep(2500);
        let L = await layout();
        const inside = (r) => r.x >= safe.l - 0.5 && r.y >= safe.t - 0.5 && r.r <= L.W - safe.r + 0.5 && r.b <= L.H - safe.b + 0.5;
        const hit = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
        const ctrls = { perf: L.perf, dev: L.dev, target: L.target, zoom: L.zoom, joy: L.joy, ...Object.fromEntries(L.skills.map((r, i) => [`skill${i + 1}`, r])) };
        const out = Object.entries(ctrls).filter(([, r]) => !inside(r)).map(([k, r]) => [k, r]);
        check(`介面（${vp.width}×${vp.height}）：所有按鈕、搖桿、效能列、血條都在畫面內且避開 Safe Area`, out.length === 0, { safe, out });
        const keys = Object.keys(ctrls);
        const ov = [];
        for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (hit(ctrls[keys[i]], ctrls[keys[j]])) ov.push([keys[i], keys[j]]);
        check(`介面（${vp.width}×${vp.height}）：技能、搖桿、縮放、效能列、血條、開發者按鈕互不重疊`, ov.length === 0, ov);
        check("介面：測試設定都收進開發者選單（選單預設收合；畫面上沒有其他設定按鈕）", !L.menu.vis && L.outsideDev === 0 && L.menuButtons.length >= 14, { menuVisible: L.menu.vis, outside: L.outsideDev, inMenu: L.menuButtons.length });
        check("介面：效能列精簡（1 行、高度 ≤ 22 px），不擋住目標血條", L.perf.h <= 22 && !hit(L.perf, L.target), { perf: L.perf, target: L.target });
        const m = /DC (\d+)｜([\d.]+)k面/.exec(L.perfText);
        check("統計：Draw Call、三角面不再顯示 0", m && Number(m[1]) > 0 && Number(m[2]) > 0, L.perfText);
        check("移動：沒有跳躍按鈕（跳躍只在技能動作內）", L.jumpButtons === 0, L.jumpButtons);
        await shot("closed");
        await page.click(".cv-devbtn");
        await sleep(400);
        L = await layout();
        check(`介面（${vp.width}×${vp.height}）：開發者選單展開後在畫面內（可捲動），收合按鈕仍可按`, L.menu.vis && inside(L.menu) && inside(L.dev) && !hit(L.menu, L.dev), { menu: L.menu, dev: L.dev });
        await shot("devmenu");
        await page.click(".cv-devbtn");
        await sleep(300);
        L = await layout();
        check("介面：開發者選單可收合", !L.menu.vis, L.menu);
        const r0 = await page.evaluate(() => window.__cvfx.camRadius());
        await page.click(".cv-zoom [data-zoom=in]");
        await page.click(".cv-zoom [data-zoom=in]");
        await sleep(1500);
        const r1 = await page.evaluate(() => window.__cvfx.camRadius());
        await shot("zoomed");
        await page.click(".cv-zoom [data-zoom=out]");
        await page.click(".cv-zoom [data-zoom=out]");
        await page.click(".cv-zoom [data-zoom=out]");
        await sleep(1500);
        const r2 = await page.evaluate(() => window.__cvfx.camRadius());
        check("鏡頭：＋ 可以拉近角色、－ 可以拉遠（在 2.4～16 m 範圍內）", r1 < r0 * 0.8 && r2 > r1 && r1 >= 2.39, { r0, r1, r2 });
        // 點效能列可展開詳細數字
        await page.click(".cv-perf");
        await sleep(200);
        const longTxt = await page.evaluate(() => document.querySelector(".cv-perf").textContent);
        check("效能列：點一下展開詳細數字", /10 秒平均/.test(longTxt) && /三角面/.test(longTxt), longTxt);
        await page.click(".cv-perf");
      } else if (tcase.id === "audio") {
        // 音效 V2：每個音效離線算出波形（星夜／白天兩種殘響），輸出 WAV 試聽檔並檢查音量
        const adir = `${outDir}audio-${name}/`;
        mkdirSync(adir, { recursive: true });
        const keys = await page.evaluate(() => window.__cvfx.sfxKeys);
        const rows = [];
        for (const env of ["dark", "bright"]) {
          for (const k of keys) {
            const r = await page.evaluate(([kk, ee]) => window.__cvfx.renderSfx(kk, ee), [k, env]);
            if (name === "chromium") writeFileSync(`${adir}${env}_${k}.wav`, Buffer.from(r.wav, "base64"));
            delete r.wav;
            rows.push(r);
          }
        }
        run.results.audio = rows;
        check("音效：18 種戰鬥音效都能離線算出（WebAudio 合成）", keys.length >= 18 && rows.length === keys.length * 2, { keys: keys.length, rows: rows.length });
        check("音效：沒有破音（峰值 < 0.99，主輸出限幅器有效）", rows.every((r) => r.peak < 0.99), rows.map((r) => [r.env, r.key, +r.peak.toFixed(3)]));
        check("音效：每個音效都聽得到（峰值 > 0.05）", rows.every((r) => r.peak > 0.05), rows.filter((r) => r.peak <= 0.05).map((r) => [r.env, r.key, r.peak]));
        check("音效：長度合理（尾音在 3 秒內結束）", rows.every((r) => r.activeSec > 0.05 && r.activeSec < 3), rows.map((r) => [r.env, r.key, +r.activeSec.toFixed(2)]));
        const dk = (k) => rows.find((r) => r.env === "dark" && r.key === k);
        const en = (k) => dk(k).rms * dk(k).rms * dk(k).samples;
        check("音效：重擊／暴擊／地面衝擊比一般命中更有份量（總能量較大）", en("hitHeavy") > en("hit") && en("crit") > en("hit") && en("groundImpact") > en("hit") && en("explosion") > en("hit"), Object.fromEntries(["hit", "hitHeavy", "crit", "groundImpact", "explosion"].map((k) => [k, +en(k).toFixed(1)])));
        const bk = (k) => rows.find((r) => r.env === "bright" && r.key === k);
        check("音效：白天草地殘響比星夜競技場短", bk("explosion").activeSec < dk("explosion").activeSec, { dark: dk("explosion").activeSec, bright: bk("explosion").activeSec });
      } else if (tcase.id === "perf") {
        // 效能比較（Stage 3）：固定鏡頭、固定站位（8×4 方陣），4／8／16／32 人 × 三種做法
        //   stage3＝合併模型＋遠距離減面版；stage2＝合併模型（不切遠距離）；legacy＝Stage 1 做法（lite 模型）
        //   static＝大家站著不放技能（只比模型）；active＝依序輪流放技能（含特效）
        const matrix = [];
        const lodDebug = [];
        const MODES = process.env.CVFX_PERF_MODES ? process.env.CVFX_PERF_MODES.split(",") : ["stage3", "stage2", "legacy"];
        for (const mode of MODES) {
          if (mode !== "stage3") {
            const q = mode === "stage3vis" ? "lodMode=visible" : `perf=${mode}`;
            await page.goto(`${server.url}/?lab=combat&q=medium&g=male&mute=1&${q}`, { waitUntil: "load" });
            await page.waitForFunction(() => window.__cvfx?.ready === true, null, { timeout: 300000 });
          }
          for (const n of [4, 8, 16, 32]) {
            const scn = await page.evaluate((k) => window.__cvfx.perfScene(k, false), n);
            await sleep(3500);
            const st = await page.evaluate(() => window.__cvfx.perfSnapshot());
            matrix.push({ mode, players: n, phase: "static", scene: scn, ...st });
            if (mode.startsWith("stage3") && n === 8) lodDebug.push({ mode, dbg: await page.evaluate(() => window.__cvfx.lodDebug()) });
            await shot(`perf_${mode}_${n}_static`);
            await page.evaluate((k) => window.__cvfx.perfScene(k, true), n);
            await sleep(9000);
            const ac = await page.evaluate(() => window.__cvfx.perfSnapshot());
            matrix.push({ mode, players: n, phase: "active", ...ac });
            if (n === 32 || n === 8) await shot(`perf_${mode}_${n}_active`);
          }
          await page.evaluate(() => window.__cvfx.perfSceneEnd());
        }
        run.results.perfMatrix = matrix;
        run.results.lodDebug = lodDebug;
        const get = (mode, n, ph = "static") => matrix.find((m) => m.mode === mode && m.players === n && m.phase === ph);
        const s3 = get("stage3", 32), s2 = get("stage2", 32), l32 = get("legacy", 32);
        check("效能：比較條件一致（同人數時三種做法的可見人數相同）", [4, 8, 16, 32].every((n) => new Set(["stage3", "stage2", "legacy"].map((m) => get(m, n)?.visiblePlayers)).size === 1), Object.fromEntries([4, 8, 16, 32].map((n) => [n, ["stage3", "stage2", "legacy"].map((m) => get(m, n)?.visiblePlayers)])));
        check("效能：32 人時遠距離版有啟用（後兩排切成遠距離版）", s3 && s3.farPlayers >= 14 && s3.nearPlayers >= 14, { near: s3?.nearPlayers, far: s3?.farPlayers });
        check("效能：32 人靜態時 Stage 3 三角面比 Stage 2 少 20% 以上（只有後兩排是遠距離版）", s3 && s2 && s3.triangles < s2.triangles * 0.8, { stage3: s3?.triangles, stage2: s2?.triangles });
        check("效能：32 人時 Stage 3 的 Draw Call 與 Stage 2 相同水準（合併繪製保留，差 ≤ 5%）", s3 && s2 && s3.draws <= s2.draws * 1.05, { stage3: s3?.draws, stage2: s2?.draws });
        check("效能：32 人時 Stage 3 的 Draw Call 比 Stage 1 做法少一半以上", s3 && l32 && s3.draws < l32.draws * 0.5, { stage3: s3?.draws, legacy: l32?.draws });
      } else if (tcase.id !== "low-multi8") {
        // 逐一施放 6 個技能
        for (const [i, sk] of SKILLS.entries()) {
          const n0 = await page.evaluate(() => window.__cvfx.sync.length);
          // 站到最近怪物前方
          await page.evaluate(() => {
            const s = window.__cvfx.stats();
            const alive = s.monsters.filter((m) => m.state === "idle");
            const m = alive[0] ?? s.monsters[0];
            const dx = -m.pos[0], dz = -m.pos[1];
            const L = Math.hypot(dx, dz) || 1;
            window.__cvfx.moveTo(m.pos[0] + (dx / L) * 1.6, m.pos[1] + (dz / L) * 1.6);
          });
          await sleep(200);
          const ok = await page.evaluate((id) => window.__cvfx.cast(id), sk);
          check(`施放 ${i + 1}. ${sk}`, ok, null);
          // 第一次命中時截圖
          await page.waitForFunction((n) => window.__cvfx.sync.length > n, n0, { timeout: 15000 }).catch(() => {});
          await sleep(HIT_SHOT_DELAY[sk] ?? 0);
          await shot(`${String(i + 1).padStart(2, "0")}_${sk}_hit`);
          await page.waitForFunction(() => !window.__cvfx.busy(), null, { timeout: 20000 }).catch(() => {});
          await sleep(1200);
          const recs = await page.evaluate((n) => window.__cvfx.sync.slice(n), n0);
          run.results[sk] = recs;
          check(`${sk}：至少一次命中結算`, recs.length > 0 && recs.some((r) => r.targets > 0), recs.map((r) => ({ hit: r.hit, targets: r.targets, dmg: r.damage })));
          check(
            `${sk}：命中當格動作時間＝時間軸時間（誤差 ≤ 1 格 1/30 s），傷害數字同一格顯示`,
            recs.every((r) => (r.kind === "projectile" || Math.abs(r.animT - r.clipT) <= 1 / 30 + 0.002) && r.shownSameFrame),
            recs.map((r) => ({ hit: r.hit, kind: r.kind, clipT: r.clipT, animT: r.animT, same: r.shownSameFrame })),
          );
        }
        // 攻速上限
        await page.evaluate(() => window.__cvfx.setAspd(250));
        const n1 = await page.evaluate(() => window.__cvfx.sync.length);
        await page.evaluate(() => {
          const s = window.__cvfx.stats();
          const m = s.monsters.find((x) => x.state === "idle") ?? s.monsters[0];
          window.__cvfx.moveTo(m.pos[0] * 0.75, m.pos[1] * 0.75);
        });
        await sleep(2600);
        await page.evaluate(() => window.__cvfx.cast("triple_slash"));
        await page.waitForFunction(() => !window.__cvfx.busy(), null, { timeout: 20000 }).catch(() => {});
        const r250 = await page.evaluate((n) => window.__cvfx.sync.slice(n), n1);
        run.results.aspd250 = r250;
        if (r250.length >= 2) {
          const gap = r250[1].realT - r250[0].realT;
          // 攻速 160 上限：s1→s2 片段間隔 0.33 s / 1.6 ≈ 0.206 s（加上頓幀 45 ms）；若攻速未被限制（2.5 倍）會只有 0.132 s
          check("攻速 250 → 依上限 160 播放（命中間隔 ≥ 0.33/1.6）", gap >= 0.33 / 1.6 - 0.02, { gap });
        } else check("攻速 250 → 依上限 160 播放", false, r250);
        await page.evaluate(() => window.__cvfx.setAspd(100));
        // 三段品質：各跑 10 秒自動示範
        const tiers = {};
        for (const t of ["high", "medium", "low"]) {
          await page.evaluate((x) => window.__cvfx.setTier(x), t);
          await page.evaluate(() => window.__cvfx.setAuto(true));
          await sleep(10000);
          const p = await page.evaluate(() => window.__cvfx.perf());
          const s2 = await page.evaluate(() => window.__cvfx.stats());
          tiers[t] = { perf: p, vfx: s2.vfx, budget: s2.budget };
          await shot(`tier_${t}`);
        }
        await page.evaluate(() => window.__cvfx.setAuto(false));
        run.results.tiers = tiers;
        check("三段品質都能運作（每段都有生成特效）", ["high", "medium", "low"].every((t) => tiers[t].budget.granted > 0), Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, { fps: v.perf.avg10s, draws: v.perf.draws, particles: v.vfx.particles }])));
      } else {
        // 多人模擬 8 位＋自己自動示範 20 秒
        await page.evaluate(() => window.__cvfx.setAuto(true));
        await sleep(20000);
        const p = await page.evaluate(() => window.__cvfx.perf());
        st = await page.evaluate(() => window.__cvfx.stats());
        run.results.multi = { perf: p, stats: st };
        await shot("multi8");
        check("多人模擬：8 位其他玩家同時施放", st.ghosts === 8, st.ghosts);
        check("多人預算：同時特效不超過上限（自己的命中閃光／暴擊除外）、其他玩家的特效被限制", st.budget.active - st.budget.activeCritical <= 18 && st.budget.activeRemote <= Math.floor(18 * 0.45) && st.budget.denied > 0, st.budget);
        // CI 軟體繪圖下 FPS 很低，改成：關掉自動示範後自己站到怪物前施放一次，等它命中
        await page.evaluate(() => window.__cvfx.setAuto(false));
        await page.waitForFunction(() => !window.__cvfx.busy(), null, { timeout: 60000 }).catch(() => {});
        const nm = await page.evaluate(() => window.__cvfx.sync.length);
        await page.evaluate(() => {
          const s = window.__cvfx.stats();
          const m = s.monsters.find((x) => x.state === "idle") ?? s.monsters[0];
          const dx = -m.pos[0], dz = -m.pos[1];
          const L = Math.hypot(dx, dz) || 1;
          window.__cvfx.moveTo(m.pos[0] + (dx / L) * 1.6, m.pos[1] + (dz / L) * 1.6);
        });
        await sleep(500);
        await page.evaluate(() => window.__cvfx.cast("triple_slash"));
        await page.waitForFunction((n) => window.__cvfx.sync.length > n, nm, { timeout: 90000 }).catch(() => {});
        const recsM = await page.evaluate((n) => window.__cvfx.sync.slice(n), nm);
        check("多人：自己的技能仍然有命中結算與傷害數字", recsM.length > 0 && recsM.every((r) => r.shownSameFrame), recsM.map((r) => ({ hit: r.hit, targets: r.targets, same: r.shownSameFrame })));
      }
      st = await page.evaluate(() => window.__cvfx.stats());
      const errs = await page.evaluate(() => window.__cvfx.errors);
      run.results.final = st;
      check("沒有頁面錯誤", run.errors.length === 0 && errs.length === 0, [...run.errors, ...errs].slice(0, 10));
    } catch (e) {
      check("執行完成", false, String(e));
      await shot("error");
    }
    report.runs.push(run);
    await ctx.close();
  }
  await browser.close();
}
await server.close();
report.failures = failures;
report.finishedAt = new Date().toISOString();
writeFileSync(`${outDir}report.json`, JSON.stringify(report, null, 2));
const lines = [];
for (const r of report.runs) {
  lines.push(`## ${r.browser} / ${r.case}`);
  for (const [k, v] of Object.entries(r.checks)) lines.push(`- ${v.ok ? "✅" : "❌"} ${k}`);
  if (r.errors.length) lines.push(`- errors: ${r.errors.slice(0, 5).join(" | ")}`);
}
writeFileSync(`${outDir}summary.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`failures: ${failures}`);
process.exit(failures ? 1 : 0);
