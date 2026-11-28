import { getMap } from "../shared/maps.ts";
import { StarsproutTerrain } from "../../src/maps/starsprout/terrain.ts";
import { WALK_HALF, RIVER_HALF } from "../../src/maps/starsprout/layout.ts";
const tq = getMap("starsprout").terrainQuery!;
let t = performance.now();
const terrain = new StarsproutTerrain();
console.log("terrain", performance.now() - t);
t = performance.now();
let n = 0;
for (let x = -78; x <= 78; x += 1) for (let z = -78; z <= 78; z += 1) { terrain.river(x, z); n++; }
console.log("river calls", n, performance.now() - t);
t = performance.now();
console.log(tq.canStand(WALK_HALF - 0.5, 0, 0.3), terrain.walkable(WALK_HALF-0.5,0), performance.now()-t);
