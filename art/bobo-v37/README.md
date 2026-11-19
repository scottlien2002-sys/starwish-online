# 星露啵啵 V3.7 模型

V3.7 只升級材質（玻璃果凍質感），**幾何、貼圖與 V3.6 完全相同**。

模型檔由 V3.6 衍生（二進位區塊不變，只改根節點名稱與 extras 版本）：

```
for lod in high medium low; do
  python3 art/common/glb_tools.py derive public/models/bobo_v36_$lod.glb public/models/bobo_v37_$lod.glb StarDewBoboV37_$lod \
    '{"root":{"bellyStar":{"version":"3.7"},"monster":{"version":"v37","basedOn":"bobo_v36_'$lod'.glb"}},"asset":{"version":"3.7"}}'
done
python3 art/common/glb_tools.py check public/models bobo v37 normal
```

造型、翅膀、頭頂星星的幾何修改在 V3.8 進行。
