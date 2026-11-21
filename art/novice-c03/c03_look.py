"""
C0.3 配色與材質：與 C0.2 完全相同（材質、配色、臉部貼圖都不變），只修正臉部貼圖的 UV 投影。

【男生側面「多餘眼睛」的原因】
C0～C0.2 的臉部貼圖是「整顆頭的平面投影」（u 取 x、v 取 z，前後不分）。眼睛位置（x ±0.10、z 0.81）在後腦勺
（y 0.10～0.21）也會被投影到同一組 UV，所以後腦勺也印著兩隻眼睛。平常被頭髮蓋住；C0.2 後腦髮殼收窄後，
髮束之間的縫隙露出頭皮，側面就看到藍色的眼睛。模型中沒有重複的眼睛網格或眼睛平面（頭部只有一個網格，
眼睛都在臉部貼圖上），也不是深度排序、背面剔除或透明材質的問題（材質全為不透明）。

【修正】
UV 依「離臉部多遠（往後的 y）」平順地移到貼圖四個角落的膚色（沒有五官）：y ≤ -0.04（臉的正面）完全不變；
往後 3 公分內逐漸移動，之後的點全部對到角落。左半邊頭往左邊角落、右半邊往右邊角落；高度在 0.78 以上往上角、
以下往下角（往後這條分界升到頭頂 1.1，讓四個角落交會的點落在頭頂髮殼內）。後腦所有點都在貼圖的邊緣行列，彼此之間的內插只沿著貼圖邊緣（全是膚色），不會經過五官；
過渡帶的點都在臉的左右外側、下巴或頭頂，移動路徑也不經過眼睛、眉毛、嘴巴（已用程式沿每條網格邊抽樣檢查）。
臉的正面（眼睛、眉毛、嘴巴、腮紅）位置與大小完全不變。
"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "novice-c02"))
import c02_look as L2  # noqa: E402

PALETTE = L2.PALETTE
SURFACE = L2.SURFACE
albedo = L2.albedo
face_texture = L2.face_texture
part_key = L2.part_key
strand_shading = L2.strand_shading
FACE_Y0 = -0.04   # 臉的正面：比這個更前面的點，UV 與 C0.2 完全相同
FACE_BAND = 0.03  # 往後 3 公分內完成移動
Z_SPLIT = 0.78    # 這個高度以上往貼圖上緣移、以下往下緣移


def uv_of(P):
    uv = L2.uv_of(P).copy()
    t = np.clip((P[:, 1] - FACE_Y0) / FACE_BAND, 0, 1)
    t = t * t * (3 - 2 * t)
    tu = np.where(P[:, 0] >= 0, 0.995, 0.005)
    # 上／下角的分界高度：臉側 0.78，往後迅速升到 1.1（後腦四個角落交會的唯一一點落在頭頂髮殼裡，看不到）
    zs = Z_SPLIT + (1.1 - Z_SPLIT) * np.clip((P[:, 1] + 0.02) / 0.07, 0, 1)
    tv = np.where(P[:, 2] >= zs, 0.995, 0.005)
    uv[:, 0] = uv[:, 0] + (tu - uv[:, 0]) * t
    uv[:, 1] = uv[:, 1] + (tv - uv[:, 1]) * t
    return uv
