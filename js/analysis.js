/**
 * Picks the right solver for the problem's mode.
 * Frame problems use the rigid-body solver (with hinges); truss problems
 * use the method of joints.
 */
import { solve } from './solver.js';
import { solveTruss } from './truss.js';

export function analyze(problem) {
  return problem.mode === 'truss' ? solveTruss(problem) : solve(problem);
}
