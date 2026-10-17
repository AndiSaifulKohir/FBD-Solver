# Free body diagram solver

Draw a beam, frame or truss, add supports and loads, and get the reactions, internal forces and bar forces for statically determinate problems. Everything runs in the browser. There is no server and no build step.
Still in development, expect bugs and breaking changes. Found an issue? Please let me know.

**Live web version:** *[FBD-Solver](https://andisaifulkohir.github.io/FBD-Solver/)*

Two modes, chosen with the **Frame** / **Truss** buttons:

- **Frame**: beams and frames with rigid joints, optionally with internal hinges (three-hinged portals, Gerber beams).
- **Truss**: pin-jointed bars solved joint by joint (method of joints).

In frame mode the solver enforces the three planar equilibrium conditions:

```
ΣFx = 0    ΣFy = 0    ΣM = 0
```

It shows the equations with your numbers filled in, solves them, draws the reaction arrows on the diagram, and then re-checks that the forces and moments sum to zero about two different points.

Once the reactions are known, it also draws the **normal force (N)**, **shear / transversal force (V)** and **bending moment (M)** diagrams along every member.

## Run it

Browsers block ES modules and `fetch` on `file://`, so serve the folder over HTTP:

```bash
npx serve .
# or: python3 -m http.server
# or: the "Live Server" extension in VS Code
```

Then open the address it prints.

## Using it

| Tool                 | Key               | What it does                                                            |
| -------------------- | ----------------- | ----------------------------------------------------------------------- |
| Select               | `V`             | Click to edit, drag to move, drag the white handles to move an endpoint |
| Member / Bar         | `M`             | Click joints in turn to draw a frame or truss. `Esc` finishes         |
| Hinge                | `H`             | Click a point on a member to insert an internal pin (frame mode)        |
| Pin / Roller / Fixed | `P` `R` `F` | Click to place a support. Fixed is frame mode only                      |
| Force                | `L`             | Click where a point load acts                                           |
| Moment               | `C`             | Click where a couple acts (frame mode)                                  |
| Distributed          | `D`             | Click the start and end of a uniform load (frame mode)                  |

The four buttons above the drawing switch between the free body diagram and the **N**, **V** and **M** diagrams (keys `1` to `4`). The diagrams are read-only. Picking a tool takes you back to editing.

`Delete` removes the selected item, `Ctrl/Cmd+Z` undoes, and right-click cancels the current tool. Points snap to a 0.5 m grid. Type exact values in the **Selected item** panel. The solution updates as you drag.

## Conventions

- Units are kN, m and degrees.
- `+x` is right and `+y` is up.
- Angles are measured counterclockwise from `+x`, so 270° points down.
- Moments are positive counterclockwise.
- A **pin** has two unknowns (`Ax`, `Ay`). A **roller** has one, along its direction (default 90°, up). A **fixed** support has three (`Ax`, `Ay`, `MA`).
- A distributed load is replaced by one resultant (intensity × length) at its midpoint.
- Members are for drawing. For a single rigid body, equilibrium depends on where loads and supports are, not on the geometry between them.

## Hinges and portal frames

A hinge is an internal pin: it passes force but no bending moment. Put one in the middle of a beam or at a joint, and the solver adds an equation for it: the moment about the hinge of everything on one side is zero. A hinge where k members meet adds k − 1 equations.

That is what makes a **three-hinged portal** solvable. Two pin supports give 4 unknowns, and the three equilibrium equations plus the hinge equation make 4 equations. The same applies to a **Gerber beam**: a continuous beam on three supports becomes determinate once a hinge is added. A rigid portal on a pin and a roller needs no hinge. Try the examples.

Rules for hinges:

- A hinge must sit on a member or at a joint. Members meeting another member in a T are split there automatically.
- Applied moments and fixed supports cannot be placed at a hinge.
- A hinge must split the frame in two. A hinge inside a closed loop is not supported yet.
- The diagrams show the moment is zero at every hinge.

## Trusses

Switch to **Truss** mode. Members become pin-jointed bars, supports are pins or rollers, and loads are forces at joints. The solver writes ΣFx = 0 and ΣFy = 0 at every joint and solves all of them together for the bar forces and reactions.

- Bars are coloured **blue for tension** and **red for compression**, labelled with the force and `T` or `C`. Zero-force members are grey.
- Joints are numbered on the drawing, and the bar table in the Solution panel uses those numbers.
- The **Normal N** button (key `2`) shows a force map: each bar's thickness is proportional to its axial force, blue for tension and red for compression, with the signed value on the bar. The bar forces are the truss's normal forces. Shear and moment views do not apply to a truss, because bars carry axial force only.
- A truss is statically determinate when bars + reactions = 2 × joints. Fewer means a mechanism (reported as unstable). More means indeterminate, and the degree is shown.
- Supports and loads must sit at joints, which are bar ends. Moments, distributed loads, hinges and fixed supports are rejected with a message.
- Every joint is re-checked after solving, and the largest unbalanced force is shown.

## Internal force diagrams

These diagrams are for frame mode and use the method of sections. (For trusses, see the Normal N force map above.) At each point of a member the frame is cut, and the part on one side is balanced to find N, V and M there.

- **N**: positive is tension.
- **V**: positive shear turns a segment clockwise.
- **M**: positive is sagging, which is tension on the underside of a horizontal member. It is drawn on the tension side, as is usual for frames. N and V are drawn on the left of each member.
- Members are read left to right, or bottom to top if vertical. The signs do not depend on the order you drew the joints in.
- Blue areas are positive and red areas are negative. Labels mark segment ends and the largest and smallest values. The moment peak is placed exactly where V crosses zero.
- The Solution panel lists the maximum and minimum of N, V and M and where they occur.

Requirements for the diagrams:

- The reactions must be solved.
- The members must form one connected frame **without closed loops**. A closed box needs extra equations, which are not implemented yet.
- Every support and load must sit on a member or at a joint, and distributed loads must lie along a member. Otherwise the panel says what to fix.

## What the solver reports

| Status        | Meaning                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| Solved        | Unique reactions found. A warning appears if the supports restrain fewer than 3 motions |
| Unstable      | The supports cannot balance the loads, or the reactions are not independent             |
| Indeterminate | More than 3 unknown reactions, so equilibrium alone is not enough                       |
| Incomplete    | No supports yet                                                                         |

## Problem files

Problems are plain JSON. `mode` is `"frame"` (the default) or `"truss"`. Use **Export** and **Import** in the app, or see [`examples/`](examples/).

```json
{
  "name": "Simply supported beam",
  "mode": "frame",
  "members":     [{ "x1": 0, "y1": 0, "x2": 6, "y2": 0 }],
  "supports":    [{ "type": "pin", "x": 0, "y": 0 },
                  { "type": "roller", "x": 6, "y": 0, "angle": 90 }],
  "forces":      [{ "x": 2, "y": 0, "magnitude": 12, "angle": 270 }],
  "moments":     [{ "x": 3, "y": 0, "value": 20 }],
  "distributed": [{ "x1": 0, "y1": 0, "x2": 4, "y2": 0, "w": 5, "angle": 270 }],
  "hinges":      [{ "x": 3, "y": 0 }]
}
```

## Project layout

```
index.html          page
css/style.css       styles
js/solver.js        frame equilibrium solver with hinges (pure, no DOM, no rounding)
js/frame.js         joints, segments and hinge branches of a frame (pure)
js/truss.js         method of joints for trusses (pure)
js/analysis.js      picks the frame or truss solver by mode
js/mathutil.js      shared helpers and the linear-equation solver
js/internal.js      N, V, M along members by the method of sections (pure)
js/model.js         problem data model and validation
js/format.js        display rounding and equation text
js/draw.js          SVG rendering
js/app.js           tools, pointer handling, panels
examples/           solved sample problems
tests/              solver, hinge, truss and internal force tests against hand calculations
```

`solver.js` never touches the DOM, so it is easy to test and reuse. Rounding is only done when displaying, never inside the solver.

## Tests

```bash
npm test
```

Uses Node's built-in test runner (Node 18 or later). No dependencies to install. The tests check textbook problems against hand calculations (including V = wL/2 and M = wL²/8 for a uniformly loaded beam, and the cantilever wall moment), confirm the equilibrium check balances, and cover the unstable, indeterminate and diagram-unavailable cases.

## Roadmap

- Method of sections for trusses
- Friction and inclined surfaces
- Show the free body diagram with supports replaced by reaction arrows
- Internal forces for frames with closed loops
- Deflected shape
- 3D statics

## Acknowledgment

This project was built with the help of Claude and GitHub Copilot in VS Code.

## License

MIT
