#!/usr/bin/env bash
# Stage 8.2：把 E2E 錄下的兩位玩家畫面（A 桌機 960×600、B iPhone 390×844）並排合成示範影片。
# 用法：bash tools/mp-video-compose.sh <video 目錄（含 A/、B/）> <輸出 mp4> [E2E 結果 json（有 videoMarks 時另外剪出戰鬥片段）]
set -euo pipefail
dir="$1"
out="$2"
res="${3:-}"
a=$(ls -t "$dir"/A/*.webm 2>/dev/null | head -1 || true)
b=$(ls -t "$dir"/B/*.webm 2>/dev/null | head -1 || true)
if [ -z "$a" ] || [ -z "$b" ]; then echo "找不到 A/B 錄影（$dir）"; exit 1; fi
command -v ffmpeg >/dev/null || sudo apt-get install -y -qq ffmpeg >/dev/null
# 兩邊縮成同高 600、左右並排（標籤用英文：執行環境不一定有中文字型）
FILTER="[0:v]scale=-2:600,setsar=1,drawbox=x=0:y=0:w=iw:h=26:color=black@0.55:t=fill,drawtext=text='A (desktop 960x600)':x=10:y=5:fontsize=16:fontcolor=white[va];[1:v]scale=-2:600,setsar=1,drawbox=x=0:y=0:w=iw:h=26:color=black@0.55:t=fill,drawtext=text='B (iPhone size 390x844)':x=10:y=5:fontsize=16:fontcolor=white[vb];[va][vb]hstack=inputs=2:shortest=1,format=yuv420p[v]"
PLAIN="[0:v]scale=-2:600,setsar=1[va];[1:v]scale=-2:600,setsar=1[vb];[va][vb]hstack=inputs=2:shortest=1,format=yuv420p[v]"
enc() { ffmpeg -y -loglevel error "$@" -i "$a" -i "$b" -filter_complex "$FILTER" -map "[v]" -c:v libx264 -preset veryfast -crf 28 -movflags +faststart "$OUT" 2>/dev/null || ffmpeg -y -loglevel error "$@" -i "$a" -i "$b" -filter_complex "$PLAIN" -map "[v]" -c:v libx264 -preset veryfast -crf 28 -movflags +faststart "$OUT"; }
OUT="$out" enc
ls -la "$out"
if [ -n "$res" ] && [ -f "$res" ]; then
  read -r s e < <(node -e 'const m=require(process.argv[1]).videoMarks||{};const s=Math.max(0,(m.fightApproach??m.firstHit??0)-3);const e=(m.respawned??m.lootDone??m.fightEnd??s+60)+3;console.log(s,e)' "$(realpath "$res")")
  clip="${out%.mp4}_fight.mp4"
  ffmpeg -y -loglevel error -ss "$s" -to "$e" -i "$out" -c:v libx264 -preset veryfast -crf 26 -movflags +faststart "$clip"
  echo "fight clip $s–$e s"; ls -la "$clip"
fi
