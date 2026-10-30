# AGENTS.md

Agent-facing guide for the **agent display** project — a single-file animated
"AI agent scheduling" dashboard with six switchable themes, plus a same-origin
proxy that feeds live Octop agent state into the FORGE theme.

## What this is

`index.html` is self-contained (HTML + CSS + JS, no build step). Six themes
(OPS, SPIDER, NEURAL, FACTORY, NEBULA, FORGE) each live in their own
`<template>` → Shadow DOM → `mountXxx(host, SR)` mount function. A shell at the
end of the file mounts themes on demand, remembers the selection in
`localStorage['agent-series-theme']`, and honors `#hash` selection.

Two data regimes coexist:

- **Simulated** by default: every theme ships a built-in mock engine producing
  tasks, feeds, tokens, reviews, loads. This is the baseline — the README and
  the on-screen "示例数据 · 本地模拟 · 未接模型" labels say so.
- **Live (FORGE only)**: an adapter inside `mountForge` pulls real state from
  a self-hosted **Octop** agent platform through `serve.mjs`, a local proxy
  that makes the page and `/api` same-origin (Octop itself does not send CORS
  headers).

## How to run

```bash
node serve.mjs [port]        # default 8081
# open http://127.0.0.1:8081/index.html#forge
```

`serve.mjs` serves `index.html` statically and reverse-proxies `/api` →
`127.0.0.1:8088` (Octop), streaming SSE through untouched. Always launch the
page via the proxy — a direct `file://` open has no `/api` to talk to.

## Octop live integration (FORGE)

Everything live is scoped to `mountForge` (index.html §14, the IIFE ending
the function). It:

- Logs in with credentials `admin / zhoudan0509`, caches the JWT in
  `localStorage` (`octop_token_v1` + expiry), re-authenticates on 401.
- Polls `/agents` every 10s; maps the running experts onto agent slots
  **A01–A05** (5 mapped), leaving **A06–A08** simulated.
- Per expert, subscribes to its newest thread's trajectory SSE
  (`/agents/{aid}/threads/{tid}/trajectory/stream?after_seq=…`, resuming by
  seq). Events (`assistant`/`tool`/`error`) drive the slot's load/status/task
  and are written into the central log; active agents fire particle bursts.

### Critical constraints — read before editing

- **Keep internal `id` on `AGENTS` entries stable.** JOBS parts reference
  agents by that id via `AGI[p.ag]`. The live mapping only sets `AGENTS[i].name`
  (a display field); it never rewrites `id`. Display helpers use
  `aname(a) = a.name || a.id`.
- **`octopLive[i]` gates simulation**: it is declared at the top of `mountForge`
  (with `var AG = []`), not where the adapter sits — `heartbeat()` and the
  `updateUI` agent loop check it to skip fake beats / loads on live slots.
  Move it only to an earlier same-scope declaration.
- **Adapter closure bug to not reintroduce**: inside `refresh()`, subscribe
  closures must capture `(slotI, aid)` explicitly — using the shared loop
  variable `ag` in the `.then` makes all five subscriptions resolve to the
  last agent and 404s follow.
- The adapter is deliberately side-effect-contained: it runs on its own
  intervals, never inside the render loop. If Octop is down or unreachable it
  logs a status to the header (`CONNECTING`/`error`) and the simulated engine
  keeps the rest of the theme animating.
- **Center "job/progress" is still simulated.** The live feed drives the left
  agent array + log only. The central black-hole job/parts/forging state is the
  local `ST` machine over the six demo `JOBS`; it does not represent real Octop
  tasks. Any claim to the contrary, or a task to wire the center to live
  trajectory data, is unfinished work to be done deliberately.

## Conventions across the six themes

- Each theme: `<template id="tpl-xxx">` + host `<div id="host-xxx">` + a
  `mountXxx(host, SR)` function. Register new themes in the `THEMES` map and
  `ORDER` array in the shell IIFE at file end; add a `.tcard` in the picker.
- Shadow DOM: style with `:host`, scope ids inside `SR` (`$ = SR.getElementById`).
- Render loops: `requestAnimationFrame(frame)`; DOM-heavy panels are updated
  on throttled accumulators (`domAcc`, `uiAcc`) inside the frame, not per-frame.
  `setInterval` handles clocks and code-typing.
- Respect `prefers-reduced-motion` (`reduce` / `RM`).
- three.js themes (NEURAL/FACTORY/NEBULA) load deps from CDN lazily via the
  shell's `THREE_DEPS`; OPS/SPIDER/FORGE are native 2D/WebGL with no external
  scripts.

## Rendering logic: shape / layout / animation

Three render stacks across the six themes; every theme shares the same
two-loop skeleton — `simStep(dt)` mutates state, `drawXxx()` paints it.

- **Canvas 2D** (OPS, SPIDER, FORGE HUD/streams): `getContext('2d')` +
  `beginPath/arc/stroke/fill` per frame. No persistent model — each shape is a
  set of canvas instructions rerun every frame; shape = the coordinate math
  (e.g. OPS flywheel scatters points with `cos/sin`, `arc` draws rings).
  Static layers may be cached offscreen (`mkLayer`) to redraw only what moves.
- **Native WebGL** (FORGE core): hand-written GLSL shaders, no dependency.
  Shape = particle distribution: `defXxx()` generators compose `sCyl/sRing/
  sGear/sLathe/sBeam/sSegs/sMix` samplers, and `makeForm(def, seed)` scatters
  N points onto each part's wireframe. `gl.uniform1f(uTime, t)` pushes time
  into the shader, so thousands of particles move on the GPU; CPU only changes
  uniforms, not per-vertex JS.
- **three.js** (NEURAL, FACTORY, NEBULA): `Scene/Group/Mesh/Points` +
  custom `ShaderMaterial`. FACTORY composes robots from `box/cyl/sph` at
  `at(o,x,y,z)` positions; NEURAL/NEBULA drive `BufferGeometry` Points arrays
  (`DynamicDrawUsage` + `needsUpdate`), animated by updating attributes or by
  `uniform uTime`. Bloom via EffectComposer.

### Layout strategies

- **OPS**: responsive — CSS grid + `ResizeObserver`, width breakpoints switch
  columns (4 → 2 → 1).
- **SPIDER**: fixed 1920×1080 board scaled by `transform:scale(var(--s))`
  where `--s = viewport/1920`. All coordinates are constants (`COLS`, `ROWS`,
  `COUCH`, `SPOTS`) — editing them relocates desks/seats.
- **FORGE**: two coordinate systems. 3D parts project to screen coords, then
  DOM labels are CSS-positioned; 2D bus wires are drawn from measured DOM
  element positions (`rel()`) — left column → "STATE IN" bus → hole →
  "DISPATCH OUT" bus → right bays.

### Animation techniques (all themes)

- **Easing**: `ease(t)=t²(3-2t)` / `easeIO` (smooth in-out) map time `t` →
  position; particle speed is the derivative of `t` over time.
- **Lerp-approach smoothing**: e.g. FORGE `g.load = clamp(g.load + (target -
  g.load) * min(1, dt*7), .06, .99)` — eases toward a target each frame so
  bursty live events don't jump.
- **Phase state machine**: FORGE jobs run `ingest→collapse→form→split→build→
  assemble→deliver→dissolve`; `updateState(dt)` advances `ST.t`, `enterPhase()`
  on overflow. The phase decides what's drawn (`ST.form` 0→1 pulls parts
  together).
- **Particle lifecycle**: FORGE `comets[]` each `{t,v,c}`, `t += dt*v`, spliced
  at `t≥1` spawning ripples/flashes; NEURAL `signals[]` travel paths via
  `lerpVectors(A,B,u)`.

### Edit-entry map

| Want to change | Edit |
|---|---|
| FORGE machine part shape | `defEngine/defCity/defGear/defArm/defHumanoid/defLine` sampler params |
| SPIDER desk layout | `const COLS / ROWS / COUCH / SPOTS` |
| FACTORY robot / shop shape | `box/cyl/at` composition in the robot/shop builders |
| NEURAL ring form | ring-band radii / `arcs(r,[[start,end],…])` in `buildWorld` |
| NEBULA cloud distribution | vertex-fill loop in `buildNebulae()` |
| Colors / fonts / light-dark | per-theme `:host{}` CSS variables |
| Animation pace | `PART_T` (FORGE seconds/part), `PDUR` (phase durations), `SIMK` (sim speed), `speed` |
| Easing feel | `ease` / `easeIO` |

## This file vs README

README is the human-facing doc (features, quick start, config table, license).
`AGENTS.md` records what an agent must know to edit safely: the simulated-vs-
live split, the Octop adapter seams, and the constraints above. Keep the two in
sync when the live integration or the theme set changes.
