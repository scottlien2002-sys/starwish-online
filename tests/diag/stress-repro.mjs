// Stage 7 診斷：重現原有 E2E「受擊規則：持續攻擊 25 秒」（新手草原 ?bobo=v38r&quality=low，iPhone 15 橫向 852×393 @2x）。
// 與原測試相同的操作（每 50 ms 呼叫一次 attack，取樣），另外記錄：實際畫格數、FPS、遊戲時間（每格 min(dt,0.1) 累加，與 Game.ts 相同）。
// 用法：node tests/diag/stress-repro.mjs <dist 目錄> <標籤> <瀏覽器> <次數>
import { loadPlaywright, serve } from "../e2e/static-server.mjs";
const [dist, label, browserName = "chromium", reps = "2"] = process.argv.slice(2);
const pw = await loadPlaywright();
const server = await serve(dist);
const browser = await pw[browserName].launch();
const out = [];
for (let i = 0; i < Number(reps); i++) {
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(server.url + "/?bobo=v38r&quality=low", { waitUntil: "load" });
  await page.waitForFunction(() => window.__starwish?.ready === true, null, { timeout: 60000 });
  await page.evaluate(() => {
    const api = window.__starwish;
    api.resetTest();
    const m = api.monsters()[0];
    api.teleport(m.x + 1.0, m.z);
  });
  const r = await page.evaluate(
    () =>
      new Promise((res) => {
        const api = window.__starwish;
        const t0 = performance.now();
        let frames = 0, gameT = 0, last = null, maxDt = 0;
        const raf = (ts) => {
          if (last !== null) {
            const dt = (ts - last) / 1000;
            gameT += Math.min(dt, 0.1);
            maxDt = Math.max(maxDt, dt);
          }
          last = ts;
          frames++;
          if (performance.now() - t0 <= 25000) requestAnimationFrame(raf);
        };
        requestAnimationFrame(raf);
        let samples = 0, hits = 0, deaths = 0;
        let prevHits = api.attackState().hits;
        const prevState = new Map();
        const step = () => {
          api.attack();
          const ph = api.attackState().hits;
          if (ph > prevHits) { hits += ph - prevHits; prevHits = ph; }
          for (const m of api.monsters()) {
            if (m.state === "death" && prevState.get(m.id) !== "death") deaths++;
            prevState.set(m.id, m.state);
          }
          samples++;
          if (performance.now() - t0 > 25000) res({ samples, hits, deaths, frames, wallSec: (performance.now() - t0) / 1000, fps: frames / ((performance.now() - t0) / 1000), gameSec: gameT, maxDt, hitsPerGameSec: hits / Math.max(gameT, 1e-6) });
          else setTimeout(step, 50);
        };
        step();
      }),
  );
  // 渲染成本：一格的平均時間（scene.render 以外的負擔一併計入）
  const perf = await page.evaluate(() => {
    const e = window.__starwish;
    return { draw: e.perf?.()?.drawCalls ?? null };
  });
  out.push({ label, browser: browserName, rep: i, ...r, ...perf });
  console.log(JSON.stringify(out[out.length - 1]));
  await ctx.close();
}
await browser.close();
await server.close();
