/**
 * 星芽原野營地傳送陣（Stage 7.1）：與星芽村南方傳送陣同一套美術——
 * 藍色魔法陣地面（貼合地形）＋村莊傳送門模型裡的金色符文環與光柱（portals_*.glb 的 Portal_rune／Portal_fx，縮小 0.72 倍）。
 * 只有地面與光，沒有碰撞，不擋營地道路與行走。
 */
import { Color3, Constants, DynamicTexture, Mesh, MeshBuilder, SceneLoader, StandardMaterial, TransformNode, VertexBuffer, type AbstractMesh, type Scene } from "@babylonjs/core";

export interface CampPortal {
  root: TransformNode;
  meshes: AbstractMesh[];
  update(dt: number): void;
}

function circleTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture("campPortalTex", { width: size, height: size }, scene, true);
  const g = tex.getContext() as CanvasRenderingContext2D;
  const c = size / 2;
  g.clearRect(0, 0, size, size);
  // 藍色魔法陣底：中心亮、邊緣漸淡
  const bg = g.createRadialGradient(c, c, 0, c, c, c);
  bg.addColorStop(0, "rgba(150,205,255,0.95)");
  bg.addColorStop(0.45, "rgba(70,130,240,0.85)");
  bg.addColorStop(0.86, "rgba(35,70,190,0.75)");
  bg.addColorStop(1, "rgba(30,60,170,0)");
  g.fillStyle = bg;
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();
  const gold = "rgba(255,214,120,1)";
  const ring = (r: number, w: number, col = gold): void => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.stroke();
  };
  ring(c * 0.93, size * 0.018);
  ring(c * 0.84, size * 0.008);
  ring(c * 0.52, size * 0.012);
  ring(c * 0.44, size * 0.006, "rgba(220,240,255,0.9)");
  // 符文：外圈兩個環之間的小記號
  g.fillStyle = gold;
  g.font = `bold ${Math.round(size * 0.05)}px serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const glyphs = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ";
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.save();
    g.translate(c + Math.cos(a) * c * 0.885, c + Math.sin(a) * c * 0.885);
    g.rotate(a + Math.PI / 2);
    g.fillText(glyphs[i]!, 0, 0);
    g.restore();
  }
  // 中央八芒星
  g.strokeStyle = gold;
  g.lineWidth = size * 0.01;
  for (const off of [0, Math.PI / 4]) {
    g.beginPath();
    for (let i = 0; i <= 4; i++) {
      const a = off + (i / 4) * Math.PI * 2;
      const x = c + Math.cos(a) * c * 0.5;
      const y = c + Math.sin(a) * c * 0.5;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // 往外的箭頭記號（與村莊南門地面相同的指向意象）
  g.fillStyle = "rgba(255,240,200,0.95)";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const r0 = c * 0.6;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * (r0 + size * 0.05), c + Math.sin(a) * (r0 + size * 0.05));
    g.lineTo(c + Math.cos(a + 0.06) * r0, c + Math.sin(a + 0.06) * r0);
    g.lineTo(c + Math.cos(a - 0.06) * r0, c + Math.sin(a - 0.06) * r0);
    g.closePath();
    g.fill();
  }
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

export async function buildCampPortal(
  scene: Scene,
  o: { x: number; z: number; radius: number; surface: (x: number, z: number) => number; baseUrl: string; lite: boolean },
): Promise<CampPortal> {
  const root = new TransformNode("campPortal", scene);
  const y0 = o.surface(o.x, o.z);
  root.position.set(o.x, y0, o.z);
  const meshes: AbstractMesh[] = [];
  // 1. 地面魔法陣：細分平面，每個頂點貼合地形（營地有些微坡度）
  const n = 16;
  const disc = MeshBuilder.CreateGround("campPortalDisc", { width: o.radius * 2, height: o.radius * 2, subdivisions: n, updatable: true }, scene);
  const pos = disc.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = o.surface(o.x + pos[i]!, o.z + pos[i + 2]!) - y0 + 0.035;
  disc.updateVerticesData(VertexBuffer.PositionKind, pos);
  disc.refreshBoundingInfo();
  disc.parent = root;
  const dm = new StandardMaterial("campPortalDiscMat", scene);
  const tex = circleTexture(scene, o.lite ? 256 : 512);
  dm.diffuseTexture = tex;
  dm.emissiveTexture = tex;
  dm.opacityTexture = tex;
  dm.diffuseColor = new Color3(0.6, 0.7, 1);
  dm.emissiveColor = new Color3(0.75, 0.8, 1);
  dm.specularColor = Color3.Black();
  dm.disableLighting = true;
  dm.useAlphaFromDiffuseTexture = true;
  dm.zOffset = -2;
  disc.material = dm;
  disc.isPickable = false;
  disc.receiveShadows = false;
  meshes.push(disc);

  // 2. 村莊傳送門的符文環與光柱（同一個模型、同樣的加法發光材質）
  const scale = o.radius / 3.2;
  const mk = (name: string, c: Color3): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = c.clone();
    m.alphaMode = Constants.ALPHA_ADD;
    m.alpha = 0.999;
    m.disableDepthWrite = true;
    m.backFaceCulling = false;
    return m;
  };
  const fxBase = o.lite ? new Color3(0.6, 0.66, 0.82) : new Color3(0.85, 0.9, 1.0);
  const runeBase = new Color3(1.0, 0.86, 0.5); // 金色符文
  const fxMat = mk("campPortalFx", fxBase);
  const runeMat = mk("campPortalRune", runeBase);
  let fxPivot: TransformNode | null = null;
  let runePivot: TransformNode | null = null;
  try {
    const r = await SceneLoader.ImportMeshAsync("", `${o.baseUrl}models/village-p3/`, `portals_${o.lite ? "lite" : "hq"}.glb`, scene);
    const keep = (prefix: string, mat: StandardMaterial): TransformNode | null => {
      const m = r.meshes.find((x) => x.name.startsWith(prefix) && x.getTotalIndices() > 0);
      if (!m) return null;
      m.setParent(null);
      const p = new TransformNode(`${prefix}_campPivot`, scene);
      p.parent = root;
      p.scaling.setAll(scale);
      m.parent = p;
      m.position.set(0, 0, 0);
      m.rotationQuaternion = null;
      m.rotation.set(0, 0, 0);
      m.scaling.setAll(1);
      m.material = mat;
      (m as Mesh).hasVertexAlpha = false;
      m.isPickable = false;
      m.receiveShadows = false;
      meshes.push(m);
      return p;
    };
    fxPivot = keep("Portal_fx", fxMat);
    runePivot = keep("Portal_rune", runeMat);
    // 其他部分（石柱、鋪面、村莊南門）不需要
    for (const m of r.meshes) if (!meshes.includes(m)) m.dispose(false, true);
    for (const t of r.transformNodes) t.dispose();
  } catch {
    // 模型載入失敗：仍保留地面魔法陣（功能不受影響）
  }
  let t = 0;
  return {
    root,
    meshes,
    update(dt: number) {
      t += Math.min(dt, 0.1);
      if (fxPivot) fxPivot.rotation.y = t * 0.25;
      if (runePivot) {
        runePivot.rotation.y = -t * 0.4;
        runePivot.position.y = 0.04 * Math.sin(t * 1.3);
      }
      const fp = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.8));
      fxMat.emissiveColor.copyFromFloats(fxBase.r * fp, fxBase.g * fp, fxBase.b * fp);
      const rp = 0.8 + 0.2 * Math.sin(t * 2.6);
      runeMat.emissiveColor.copyFromFloats(runeBase.r * rp, runeBase.g * rp, runeBase.b * rp);
    },
  };
}
