/**
 * 星廢垃圾場 V3：地標實驗場景（?map=jylab）— 獨立檢查 Tripo 模型的尺寸、朝向、底部、材質，
 * 以及吊車三件式組裝與動態（先在這裡驗證，再放進垃圾場）。
 * 只供開發與 CI 截圖使用；正式遊戲不會進入此頁。
 *
 * 網址參數：&src=<GLB 網址>（可多個，以逗號分隔）、&crane=1（載入正式吊車組裝）、&pbr=1（保留 PBR 材質對照）
 * API：window.__jylab = { ready, load(url), clear(), view(o), info(), crane(…) }
 */
import {
  type AbstractMesh,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  SceneLoader,
  type AssetContainer,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
  ArcRotateCamera,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { buildCraneRig, type CraneRig, type CraneRigSpec } from "./craneRig.ts";

export async function startLandmarkLab(canvas: HTMLCanvasElement): Promise<void> {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.78, 0.84, 0.9, 1);
  scene.fogMode = Scene.FOGMODE_NONE;
  const cam = new ArcRotateCamera("lab_cam", -Math.PI / 2, 1.2, 30, new Vector3(0, 6, 0), scene);
  cam.minZ = 0.1;
  cam.maxZ = 2000;
  cam.attachControl(canvas, true);
  const hemi = new HemisphericLight("lab_sky", new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.7;
  hemi.diffuse = new Color3(0.94, 0.97, 1.04);
  hemi.groundColor = new Color3(0.62, 0.55, 0.47);
  const sun = new DirectionalLight("lab_sun", new Vector3(-0.5, -1, 0.45).normalize(), scene);
  sun.intensity = 0.92;
  sun.diffuse = new Color3(1, 0.92, 0.79);
  sun.position = new Vector3(40, 80, -40);
  const sg = new ShadowGenerator(2048, sun);
  sg.usePercentageCloserFiltering = true;
  sg.darkness = 0.35;
  sg.bias = 0.0015;
  sg.normalBias = 0.02;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 200;

  // 地面：1 m 細格、5 m 粗格（量尺寸用）
  const gt = new DynamicTexture("lab_grid", { width: 1024, height: 1024 }, scene, true);
  const g = gt.getContext();
  g.fillStyle = "#9fb08c";
  g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = "rgba(0,0,0,0.18)";
  g.lineWidth = 2;
  for (let i = 0; i <= 50; i++) {
    const p = (i / 50) * 1024;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, 1024);
    g.moveTo(0, p);
    g.lineTo(1024, p);
    g.stroke();
  }
  g.strokeStyle = "rgba(0,0,0,0.45)";
  g.lineWidth = 4;
  for (let i = 0; i <= 10; i++) {
    const p = (i / 10) * 1024;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, 1024);
    g.moveTo(0, p);
    g.lineTo(1024, p);
    g.stroke();
  }
  gt.update();
  const ground = MeshBuilder.CreateGround("lab_ground", { width: 100, height: 100 }, scene);
  const gm = new StandardMaterial("lab_ground_m", scene);
  gm.diffuseTexture = gt;
  (gm.diffuseTexture as DynamicTexture).uScale = 2;
  (gm.diffuseTexture as DynamicTexture).vScale = 2;
  gm.specularColor = Color3.Black();
  ground.material = gm;
  ground.receiveShadows = true;

  // 比例尺：玩家（約 1.25 m 的 Q 版角色）
  const human = new TransformNode("lab_human", scene);
  const hm = new StandardMaterial("lab_human_m", scene);
  hm.diffuseColor = new Color3(0.35, 0.45, 0.95);
  const body = MeshBuilder.CreateCapsule("lab_body", { height: 1.25, radius: 0.28 }, scene);
  body.position.y = 0.625;
  body.material = hm;
  body.parent = human;
  const head = MeshBuilder.CreateSphere("lab_head", { diameter: 0.55 }, scene);
  head.position.y = 1.0;
  head.material = hm;
  head.parent = human;
  sg.addShadowCaster(body);
  human.position.set(0, 0, -6);

  const loaded: AbstractMesh[][] = [];
  const pbr = new URLSearchParams(location.search).get("pbr") === "1";

  const toStd = (m: AbstractMesh): void => {
    const src = m.material as unknown as { albedoTexture?: StandardMaterial["diffuseTexture"]; bumpTexture?: StandardMaterial["bumpTexture"] } | null;
    if (!src || pbr) return;
    const s = new StandardMaterial(`${m.name}_std`, scene);
    if (src.albedoTexture) s.diffuseTexture = src.albedoTexture;
    if (src.bumpTexture) s.bumpTexture = src.bumpTexture;
    s.specularColor = new Color3(0.1, 0.1, 0.1);
    s.emissiveColor = new Color3(0.12, 0.12, 0.12);
    m.material = s;
  };

  const rigs: CraneRig[] = [];
  let simT = 0;
  let frozen = false;
  scene.onBeforeRenderObservable.add(() => {
    if (!frozen) simT += engine.getDeltaTime() / 1000;
    for (const r of rigs) r.update(simT);
  });
  const api = {
    /** 組裝一座吊車（與垃圾場相同程式）；回傳量測值 */
    async crane(spec: CraneRigSpec, files: { tower: string; boom: string; grab: string }, at: [number, number] = [0, 0]): Promise<Record<string, number>> {
      const load = (u: string): Promise<AssetContainer> => SceneLoader.LoadAssetContainerAsync("", u, scene);
      const [tower, boom, grab] = await Promise.all([load(files.tower), load(files.boom), load(files.grab)]);
      const rig = buildCraneRig(scene, { tower, boom, grab }, spec, (m) => {
        toStd(m);
        m.receiveShadows = true;
        sg.addShadowCaster(m);
      });
      rig.root.position.set(at[0], 0, at[1]);
      rigs.push(rig);
      loaded.push(rig.meshes);
      rig.update(simT);
      return { pivotY: rig.pivotY, pulleyY: rig.pulleyY, reach: rig.reach, dropMin: rig.dropMin, dropMax: rig.dropMax };
    },
    setTime(t: number, freeze = true): void {
      simT = t;
      frozen = freeze;
    },
    /** 螢幕像素 → 模型表面的世界座標（找眼睛、爐口、煙囪口等位置） */
    pick(px: number, py: number): number[] | null {
      const r = scene.pick(px, py, (m) => m.name !== "lab_ground" && !m.name.startsWith("lab_"));
      return r?.hit && r.pickedPoint ? [r.pickedPoint.x, r.pickedPoint.y, r.pickedPoint.z] : null;
    },
    /** 一個節點的世界座標（例：crane_c1_hang） */
    nodePos(name: string): number[] | null {
      const n = scene.getTransformNodeByName(name);
      if (!n) return null;
      n.computeWorldMatrix(true);
      const p = n.getAbsolutePosition();
      return [p.x, p.y, p.z];
    },

    ready: true,
    engine,
    scene,
    async load(url: string, opts: { scale?: number; x?: number; z?: number; y?: number; yaw?: number } = {}): Promise<{ min: number[]; max: number[]; tris: number }> {
      const r = await SceneLoader.ImportMeshAsync("", "", url, scene);
      const root = new TransformNode(`lab_root_${loaded.length}`, scene);
      for (const m of r.meshes) if (!m.parent) m.parent = root;
      root.scaling.setAll(opts.scale ?? 1);
      root.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
      root.rotation.y = opts.yaw ?? 0;
      const meshes = r.meshes.filter((m) => m.getTotalVertices() > 0);
      for (const m of meshes) {
        toStd(m);
        m.receiveShadows = true;
        sg.addShadowCaster(m);
      }
      loaded.push(meshes);
      root.computeWorldMatrix(true);
      const b = root.getHierarchyBoundingVectors(true);
      return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z], tris: meshes.reduce((a, m) => a + m.getTotalIndices() / 3, 0) };
    },
    clear(): void {
      for (const list of loaded) for (const m of list) m.dispose();
      loaded.length = 0;
      for (const r of rigs) r.root.dispose();
      rigs.length = 0;
    },
    view(o: { alpha: number; beta: number; radius: number; target: [number, number, number]; fov?: number; ortho?: number }): void {
      cam.alpha = o.alpha;
      cam.beta = o.beta;
      cam.radius = o.radius;
      cam.target.set(o.target[0], o.target[1], o.target[2]);
      cam.fov = o.fov ?? 0.8;
      if (o.ortho) {
        cam.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
        const a = engine.getAspectRatio(cam);
        cam.orthoTop = o.ortho;
        cam.orthoBottom = -o.ortho;
        cam.orthoLeft = -o.ortho * a;
        cam.orthoRight = o.ortho * a;
      } else cam.mode = ArcRotateCamera.PERSPECTIVE_CAMERA;
    },
    human(x: number, z: number, show = true): void {
      human.position.set(x, 0, z);
      human.setEnabled(show);
    },
    ground(show: boolean): void {
      ground.setEnabled(show);
    },
    /** 擷取 y 在 [y0,y1] 範圍的頂點，依 XZ 網格（cell）分群，回傳每群的中心、範圍與最高點（找煙囪口、爐口、接合點用） */
    clusters(index: number, y0: number, y1: number, cell: number): { x: number; z: number; n: number; ymax: number; ymin: number; x0: number; x1: number; z0: number; z1: number }[] {
      const list = loaded[index] ?? [];
      const pts: number[][] = [];
      const v = new Vector3();
      for (const m of list) {
        const pos = (m as Mesh).getVerticesData?.("position");
        if (!pos) continue;
        const wm = m.computeWorldMatrix(true);
        for (let i = 0; i < pos.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(pos[i]!, pos[i + 1]!, pos[i + 2]!, wm, v);
          if (v.y >= y0 && v.y <= y1) pts.push([v.x, v.y, v.z]);
        }
      }
      // 網格連通分群
      const key = (x: number, z: number): string => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      const cells = new Map<string, number[][]>();
      for (const p of pts) {
        const k = key(p[0]!, p[2]!);
        const a = cells.get(k) ?? [];
        a.push(p);
        cells.set(k, a);
      }
      const seen = new Set<string>();
      const out = [];
      for (const k of cells.keys()) {
        if (seen.has(k)) continue;
        const stack = [k];
        seen.add(k);
        const group: number[][] = [];
        while (stack.length) {
          const c = stack.pop()!;
          group.push(...cells.get(c)!);
          const [ci, cj] = c.split(",").map(Number) as [number, number];
          for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
              const n = `${ci + di},${cj + dj}`;
              if (cells.has(n) && !seen.has(n)) {
                seen.add(n);
                stack.push(n);
              }
            }
          }
        }
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, ymax = -Infinity, ymin = Infinity;
        for (const p of group) {
          x0 = Math.min(x0, p[0]!); x1 = Math.max(x1, p[0]!);
          z0 = Math.min(z0, p[2]!); z1 = Math.max(z1, p[2]!);
          ymax = Math.max(ymax, p[1]!); ymin = Math.min(ymin, p[1]!);
        }
        out.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, n: group.length, ymax, ymin, x0, x1, z0, z1 });
      }
      return out.sort((a, b) => b.n - a.n);
    },
    /** 擷取模型頂點（世界座標）中，y 在 [y0,y1] 範圍的 XZ 範圍：找接合面用 */
    slice(index: number, y0: number, y1: number): { n: number; min: number[]; max: number[] } {
      const list = loaded[index] ?? [];
      let n = 0;
      const mn = [Infinity, Infinity];
      const mx = [-Infinity, -Infinity];
      for (const m of list) {
        const pos = (m as Mesh).getVerticesData?.("position");
        if (!pos) continue;
        const wm = m.computeWorldMatrix(true);
        const v = new Vector3();
        for (let i = 0; i < pos.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(pos[i]!, pos[i + 1]!, pos[i + 2]!, wm, v);
          if (v.y < y0 || v.y > y1) continue;
          n++;
          mn[0] = Math.min(mn[0]!, v.x);
          mn[1] = Math.min(mn[1]!, v.z);
          mx[0] = Math.max(mx[0]!, v.x);
          mx[1] = Math.max(mx[1]!, v.z);
        }
      }
      return { n, min: mn, max: mx };
    },
  };
  (window as unknown as { __jylab: typeof api }).__jylab = api;
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
}
