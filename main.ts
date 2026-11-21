// Sokoban solver: room-decomposed push-optimal search.
//
// Strategy: a level is a 1-wide hallway plus 1-4 rooms, each opening onto the
// hallway through one door. A box pushed out of its room can never come back,
// so every room is solved on its own and the level optimum is the sum of the
// room optima. Each room is solved with a breadth-first search over pushes
// (first solved state met is push-optimal), with dead-square pruning from
// reverse-push reachability and frozen 2x2-block pruning. The player walks
// between pushes on the shortest path; between rooms it walks the hallway
// treating the other rooms' boxes as walls. Budgets are counts of expanded
// states, never the clock, so two runs write the same bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Direction order is fixed everywhere (u, d, l, r) so every run agrees.
const DIRS = [
  { dx: 0, dy: -1, walk: 'u', push: 'U' },
  { dx: 0, dy: 1, walk: 'd', push: 'D' },
  { dx: -1, dy: 0, walk: 'l', push: 'L' },
  { dx: 1, dy: 0, walk: 'r', push: 'R' },
] as const;

interface Level {
  w: number;
  h: number;
  wall: Uint8Array; // 1 = wall (includes the outer frame and padded cells)
  goals: number[];
  boxes: number[]; // sorted
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  // Nothing leaves the board: the outermost frame is wall whatever it shows.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

// Cells a box can stand on and still be pushed onto some goal, ignoring the
// other boxes: walk backwards from the goals. A box at y can be pushed to x
// (one step along d) when the player can stand at y - d, so y is live when
// x is live and both y and y - d are open floor.
function liveCells(level: Level): Uint8Array {
  const { w, h, wall, goals } = level;
  const live = new Uint8Array(w * h);
  const queue: number[] = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  const floor = (i: number): boolean =>
    i >= 0 && i < w * h && wall[i] === 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const { dx, dy } of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!floor(y) || !floor(y - d) || live[y]) continue;
      live[y] = 1;
      queue.push(y);
    }
  }
  return live;
}

// Flood-fill the player's reachable region from `from` with `blocked` in the
// way. Returns the region's lowest cell; `seen` is marked with `stamp`.
function floodLow(
  level: Level,
  blocked: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  const { w, wall } = level;
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    for (let k = 0; k < 4; k++) {
      const q = k === 0 ? p - w : k === 1 ? p + w : k === 2 ? p - 1 : p + 1;
      if (wall[q] === 0 && blocked[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

// True when the box just pushed to `t` sits in a frozen 2x2 block: four
// cells of walls and boxes, one of them a box off its goal. Such a box can
// never move again, so the state is dead.
function frozenBlock(
  level: Level,
  blocked: Uint8Array,
  isGoal: Uint8Array,
  t: number,
): boolean {
  const { w, wall } = level;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!((wall[a] || blocked[a]) && (wall[b] || blocked[b]) && (wall[c] || blocked[c]) && (wall[d] || blocked[d]))) continue;
    if ((blocked[a] && !isGoal[a]) || (blocked[b] && !isGoal[b]) || (blocked[c] && !isGoal[c]) || (blocked[d] && !isGoal[d])) return true;
  }
  return false;
}

// Shortest walk from `from` to `to` around walls and boxes, lower-case LURD
// letters, first direction first on ties. Throws when unreachable.
function walkTo(
  level: Level,
  blocked: Uint8Array,
  from: number,
  to: number,
): string {
  const { w, wall } = level;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const { dx, dy, walk } of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || blocked[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = walk;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walk unreachable');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

interface PushSolution {
  pushes: number;
  moves: string;
}

// Push-optimal solution of one (sub-)level by breadth-first search over
// pushes. A state is the sorted box cells plus the player's reachable
// region, named by its lowest cell. Expands at most `maxStates` states;
// returns null when the budget runs out or the level has no solution.
function solvePushes(level: Level, maxStates: number): PushSolution | null {
  const { w, wall, goals } = level;
  const size = w * level.h;
  const isGoal = new Uint8Array(size);
  for (const g of goals) isGoal[g] = 1;
  const live = liveCells(level);
  const solved = (boxes: number[]): boolean => boxes.every((b) => isGoal[b]);
  if (level.boxes.some((b) => !live[b])) return null;

  const blocked = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  // Numeric state key: region-low * 256^nBoxes + boxes, exact while the
  // board holds at most 5 boxes (rooms hold 3-4). Whole-level searches use
  // the string key below instead.
  const numericKey = (boxes: number[], low: number): number => {
    let k = low;
    for (const b of boxes) k = k * 256 + b;
    return k;
  };
  const useNumeric = level.boxes.length <= 5;
  const keyOf = (boxes: number[], low: number): number | string =>
    useNumeric ? numericKey(boxes, low) : `${low}:${boxes.join(',')}`;

  const stateBoxes: number[][] = [level.boxes.slice()];
  const statePlayer: number[] = [level.player];
  const parent: number[] = [-1];
  const pushFrom: number[] = [-1];
  const pushTo: number[] = [-1];
  const index = new Map<number | string, number>();

  for (const b of level.boxes) blocked[b] = 1;
  const firstLow = floodLow(level, blocked, level.player, seen, ++stamp, stack);
  for (const b of level.boxes) blocked[b] = 0;
  index.set(keyOf(level.boxes, firstLow), 0);

  let found = solved(level.boxes) ? 0 : -1;
  for (let head = 0; found < 0 && head < stateBoxes.length; head++) {
    if (head >= maxStates) return null;
    const boxes = stateBoxes[head]!;
    for (const b of boxes) blocked[b] = 1;
    floodLow(level, blocked, statePlayer[head]!, seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi]!;
      for (const { dx, dy } of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        // The player must reach the square behind the box, and the box must
        // land on open, live floor.
        if (seen[b - d] !== here || wall[t] || blocked[t] || !live[t]) continue;
        blocked[b] = 0;
        blocked[t] = 1;
        const frozen = frozenBlock(level, blocked, isGoal, t);
        let key: number | string = -1;
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x, y) => x - y);
          key = keyOf(next, floodLow(level, blocked, b, mark, ++stamp, stack));
        }
        blocked[t] = 0;
        blocked[b] = 1;
        if (frozen || index.has(key) || next === null) continue;
        if (stateBoxes.length >= maxStates) {
          for (const x of boxes) blocked[x] = 0;
          return null;
        }
        index.set(key, stateBoxes.length);
        stateBoxes.push(next);
        statePlayer.push(b);
        parent.push(head);
        pushFrom.push(b);
        pushTo.push(t);
        if (solved(next)) {
          found = stateBoxes.length - 1;
          break;
        }
      }
    }
    for (const x of boxes) blocked[x] = 0;
  }
  if (found < 0) return null;

  // Rebuild the move string: for each push, walk to the pushing square,
  // then push. Walking uses the boxes as they stand before that push.
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes.slice();
  for (const s of path) {
    const from = pushFrom[s]!;
    const to = pushTo[s]!;
    const d = to - from;
    const dir = DIRS.find(({ dx, dy }) => dy * w + dx === d)!;
    for (const b of boxes) blocked[b] = 1;
    moves += walkTo(level, blocked, player, from - d);
    for (const b of boxes) blocked[b] = 0;
    moves += dir.push;
    player = from;
    const next = stateBoxes[s]!;
    boxes = next.slice();
  }
  return { pushes: path.length, moves };
}

interface Room {
  boxes: number[];
  goals: number[];
  done: boolean;
}

// Split a level into rooms: cut the hallway row's dead floor (cells no box
// can ever be pushed from onto a goal) out of the floor; each remaining
// connected component holding boxes is a room. Null when the level is not
// such a set of rooms (a box in the hallway, a goal outside any component,
// or a room whose box and goal counts differ).
function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveCells(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const { dx, dy } of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ boxes: [], goals: [], done: false });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) {
    if (part[g] < 0) return null;
    rooms[part[g]!]!.goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

// Where the player stands after `moves` from `from` on a board `w` wide.
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) {
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

// Replay a move string on the full level; returns the push count when every
// box ends on a goal, else -1.
function replay(level: Level, moves: string): number {
  const { w, wall } = level;
  const isGoal = new Set(level.goals);
  const boxes = new Set(level.boxes);
  let player = level.player;
  let pushes = 0;
  for (const ch of moves.toLowerCase()) {
    const d = ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
    const q = player + d;
    if (wall[q]) return -1;
    if (boxes.has(q)) {
      const t = q + d;
      if (wall[t] || boxes.has(t)) return -1;
      boxes.delete(q);
      boxes.add(t);
      pushes++;
    }
    player = q;
  }
  for (const b of boxes) if (!isGoal.has(b)) return -1;
  return pushes;
}

function solveLevel(level: Level): string {
  const rooms = roomsOf(level);
  if (rooms !== null) {
    let player = level.player;
    let moves = '';
    for (const room of rooms) {
      // The room's sub-level: the whole board, the other rooms' boxes (on
      // their goals once solved) standing as walls, the player where the
      // last room left it.
      const wall = level.wall.slice();
      for (const other of rooms) {
        if (other === room) continue;
        for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
      }
      const sub: Level = {
        w: level.w,
        h: level.h,
        wall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player,
      };
      let solved = solvePushes(sub, 250_000);
      if (solved === null) solved = solvePushes(sub, 2_000_000);
      if (solved === null) return '';
      moves += solved.moves;
      player = endOf(level.w, player, solved.moves);
      room.done = true;
    }
    return replay(level, moves) >= 0 ? moves : '';
  }
  // No room structure: search the whole level, with a retry at a bigger budget.
  let solved = solvePushes(level, 400_000);
  if (solved === null) solved = solvePushes(level, 2_000_000);
  if (solved === null) return '';
  return replay(level, solved.moves) >= 0 ? solved.moves : '';
}

for (const id of readdirSync(I).sort()) {
  const text = readFileSync(join(I, id, 'level.txt'), 'utf8');
  const moves = solveLevel(parseLevel(text));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
