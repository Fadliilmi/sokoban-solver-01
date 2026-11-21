# sokoban-solver-01

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Fadliilmi/sokoban-solver-01/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Fadliilmi/sokoban-solver-01/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[![Node 22](https://img.shields.io/badge/node-22-green.svg)](main.ts)

A push-optimal Sokoban solver, built for the
[make.fun](https://make.fun) sokoban-solver-01-run-20261121 competition
($100 bounty): one program answers 5 drawn levels in as few pushes as
possible.

`main.ts` is the whole solver. It runs on Node 22 with the standard library
only, no network, no clock, no randomness: budgets are counts of expanded
states, so a replay writes the same bytes.

Inside: each level is split into rooms (a 1-wide hallway plus rooms that open
onto it through one door; a box pushed out of its room can never return, so
the level optimum is the sum of the room optima). Each room is solved on its
own with a breadth-first search over pushes — the first solved state met is
push-optimal — pruned by a dead-square table from reverse-push reachability
and by frozen 2x2-block deadlock checks, with the player walking the
shortest path between pushes. Rooms are stitched together by walking the
hallway, and the stitched move string is verified by replaying it on the
full level before it is written out.

Practice set: 1,000,000 (all 5 levels solved in exactly P* pushes: 13, 16,
29, 47, 60), against the house baseline's 200,000. Whole practice run takes
about 1.3 seconds of the 60-second budget.

## Grade it locally

From the competition kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver docker
```

Or without docker, the process route:

```
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
MAKEFUN_OUTPUT_DIR=out MAKEFUN_REFERENCE_DIR=<kit>/practice/reference MAKEFUN_SCORES_DIR=scores node <kit>/program/scorer/score.ts
```
