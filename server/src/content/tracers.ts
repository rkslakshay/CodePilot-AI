/**
 * Step-by-step execution tracers for the Algorithm Studio visualiser.
 * Each tracer actually executes the algorithm on the given input and records a snapshot
 * (variables, array, highlighted indices, counters) after every meaningful operation.
 */

export interface Highlight {
  compare?: number[];
  swap?: number[];
  sorted?: number[];
  active?: number[];
  found?: number[];
  dim?: number[];
  range?: [number, number];
  pivot?: number;
}
export interface GraphView {
  nodes: { id: number; x: number; y: number }[];
  edges: { from: number; to: number; w?: number }[];
  state: Record<number, 'current' | 'visited' | 'queued' | 'done'>;
  dist?: Record<number, string>;
  activeEdge?: [number, number];
  container?: { label: string; items: number[] };
}
export interface TraceStep {
  message: string;
  line?: number;
  vars: Record<string, string | number | boolean>;
  array?: (number | string)[];
  hl?: Highlight;
  graph?: GraphView;
  list?: { kind: 'stack' | 'queue' | 'linked'; items: (number | string)[]; highlight?: number; op?: string };
  tree?: { nodes: { id: number; key: number; x: number; y: number; parent: number | null }[]; highlight?: number; path?: number[]; found?: number };
  buckets?: { slots: number[][]; highlight?: number; hashOf?: string };
  hanoi?: { rods: number[][]; move?: [number, number] };
  callStack?: string[];
  map?: Record<string, number>;
  counters: { comparisons: number; swaps: number; iterations: number };
}
export interface TraceResult {
  steps: TraceStep[];
  input: string;
  truncated: boolean;
}

const MAX_STEPS = 600;

class Recorder {
  steps: TraceStep[] = [];
  c = { comparisons: 0, swaps: 0, iterations: 0 };
  truncated = false;
  push(s: Omit<TraceStep, 'counters'>) {
    if (this.steps.length >= MAX_STEPS) {
      this.truncated = true;
      return;
    }
    this.steps.push({ ...s, array: s.array ? [...s.array] : undefined, counters: { ...this.c } });
  }
}

export function parseNumbers(text: string, fallback: number[], max = 16): number[] {
  const nums = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return fallback;
  return nums.slice(0, max).map((n) => Math.max(-9999, Math.min(9999, Math.round(n))));
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

// ------------------------------------------------------------------ sorting
function bubble(arr: number[]): Recorder {
  const r = new Recorder();
  const n = arr.length;
  const sorted: number[] = [];
  r.push({ message: `Start: ${n} elements to sort.`, vars: { n }, array: arr, hl: {} });
  for (let i = 0; i < n - 1; i++) {
    let swapped = false;
    r.c.iterations++;
    for (let j = 0; j < n - 1 - i; j++) {
      r.c.comparisons++;
      r.push({ message: `Compare arr[${j}] = ${arr[j]} with arr[${j + 1}] = ${arr[j + 1]}.`, line: 5, vars: { i, j, swapped }, array: arr, hl: { compare: [j, j + 1], sorted: [...sorted] } });
      if (arr[j] > arr[j + 1]) {
        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
        swapped = true;
        r.c.swaps++;
        r.push({ message: `${arr[j + 1]} > ${arr[j]}, so they are swapped.`, line: 6, vars: { i, j, swapped }, array: arr, hl: { swap: [j, j + 1], sorted: [...sorted] } });
      }
    }
    sorted.unshift(n - 1 - i);
    r.push({ message: `Pass ${i + 1} done: ${arr[n - 1 - i]} is in its final position.`, vars: { i, swapped }, array: arr, hl: { sorted: [...sorted] } });
    if (!swapped) {
      r.push({ message: 'No swaps in this pass — the array is already sorted. Stop early.', vars: { i, swapped }, array: arr, hl: { sorted: range(0, n) } });
      return r;
    }
  }
  r.push({ message: 'Sorting complete.', vars: {}, array: arr, hl: { sorted: range(0, n) } });
  return r;
}

function selection(arr: number[]): Recorder {
  const r = new Recorder();
  const n = arr.length;
  r.push({ message: `Start: ${n} elements.`, vars: { n }, array: arr, hl: {} });
  for (let i = 0; i < n - 1; i++) {
    let min = i;
    r.c.iterations++;
    r.push({ message: `Pass ${i + 1}: assume arr[${i}] = ${arr[i]} is the minimum.`, vars: { i, min_index: min }, array: arr, hl: { active: [min], sorted: range(0, i) } });
    for (let j = i + 1; j < n; j++) {
      r.c.comparisons++;
      r.push({ message: `Compare arr[${j}] = ${arr[j]} with current minimum ${arr[min]}.`, vars: { i, j, min_index: min }, array: arr, hl: { compare: [j, min], sorted: range(0, i) } });
      if (arr[j] < arr[min]) {
        min = j;
        r.push({ message: `New minimum ${arr[min]} at index ${min}.`, vars: { i, j, min_index: min }, array: arr, hl: { active: [min], sorted: range(0, i) } });
      }
    }
    if (min !== i) {
      [arr[i], arr[min]] = [arr[min], arr[i]];
      r.c.swaps++;
      r.push({ message: `Swap the minimum into position ${i}.`, vars: { i, min_index: min }, array: arr, hl: { swap: [i, min], sorted: range(0, i) } });
    }
  }
  r.push({ message: 'Sorting complete.', vars: {}, array: arr, hl: { sorted: range(0, n) } });
  return r;
}

function insertion(arr: number[]): Recorder {
  const r = new Recorder();
  const n = arr.length;
  r.push({ message: `Start: arr[0] alone is a sorted prefix.`, vars: { n }, array: arr, hl: { sorted: [0] } });
  for (let i = 1; i < n; i++) {
    const key = arr[i];
    let j = i - 1;
    r.c.iterations++;
    r.push({ message: `Take key = arr[${i}] = ${key}.`, vars: { i, j, key }, array: arr, hl: { active: [i], sorted: range(0, i) } });
    while (j >= 0) {
      r.c.comparisons++;
      r.push({ message: `Compare arr[${j}] = ${arr[j]} with key ${key}.`, vars: { i, j, key }, array: arr, hl: { compare: [j, j + 1], sorted: range(0, i) } });
      if (arr[j] <= key) break;
      arr[j + 1] = arr[j];
      r.c.swaps++;
      r.push({ message: `${arr[j]} > ${key}: shift it one position right.`, vars: { i, j, key }, array: arr, hl: { swap: [j, j + 1], sorted: range(0, i) } });
      j--;
    }
    arr[j + 1] = key;
    r.push({ message: `Insert key ${key} at index ${j + 1}.`, vars: { i, j, key }, array: arr, hl: { found: [j + 1], sorted: range(0, i + 1) } });
  }
  r.push({ message: 'Sorting complete.', vars: {}, array: arr, hl: { sorted: range(0, n) } });
  return r;
}

function mergeSortT(arr: number[]): Recorder {
  const r = new Recorder();
  const stack: string[] = [];
  r.push({ message: 'Start merge sort on the whole array.', vars: { left: 0, right: arr.length - 1 }, array: arr, hl: { range: [0, arr.length - 1] } });
  const merge = (l: number, m: number, h: number) => {
    const temp: number[] = [];
    let i = l;
    let j = m + 1;
    while (i <= m && j <= h) {
      r.c.comparisons++;
      r.push({ message: `Merge: compare ${arr[i]} and ${arr[j]}.`, vars: { left: l, mid: m, right: h, i, j }, array: arr, hl: { compare: [i, j], range: [l, h] }, callStack: [...stack] });
      if (arr[i] <= arr[j]) temp.push(arr[i++]);
      else temp.push(arr[j++]);
    }
    while (i <= m) temp.push(arr[i++]);
    while (j <= h) temp.push(arr[j++]);
    for (let k = 0; k < temp.length; k++) {
      arr[l + k] = temp[k];
      r.c.swaps++;
    }
    r.push({ message: `Merged range [${l}..${h}] → ${temp.join(', ')}.`, vars: { left: l, mid: m, right: h }, array: arr, hl: { found: range(l, h + 1), range: [l, h] }, callStack: [...stack] });
  };
  const sort = (l: number, h: number) => {
    stack.push(`merge_sort(${l}, ${h})`);
    r.c.iterations++;
    if (l < h) {
      const m = Math.floor((l + h) / 2);
      r.push({ message: `Split [${l}..${h}] at mid = ${m}.`, vars: { left: l, mid: m, right: h }, array: arr, hl: { range: [l, h], active: [m] }, callStack: [...stack] });
      sort(l, m);
      sort(m + 1, h);
      merge(l, m, h);
    }
    stack.pop();
  };
  sort(0, arr.length - 1);
  r.push({ message: 'Sorting complete.', vars: {}, array: arr, hl: { sorted: range(0, arr.length) } });
  return r;
}

function quickSortT(arr: number[]): Recorder {
  const r = new Recorder();
  const stack: string[] = [];
  const done = new Set<number>();
  r.push({ message: 'Start quick sort (Lomuto partition, pivot = last element).', vars: {}, array: arr, hl: {} });
  const part = (lo: number, hi: number) => {
    const pivot = arr[hi];
    let i = lo - 1;
    r.push({ message: `Partition [${lo}..${hi}] around pivot ${pivot}.`, vars: { low: lo, high: hi, pivot, i }, array: arr, hl: { pivot: hi, range: [lo, hi], sorted: [...done] }, callStack: [...stack] });
    for (let j = lo; j < hi; j++) {
      r.c.comparisons++;
      r.push({ message: `Is arr[${j}] = ${arr[j]} ≤ pivot ${pivot}?`, vars: { low: lo, high: hi, pivot, i, j }, array: arr, hl: { compare: [j, hi], pivot: hi, range: [lo, hi], sorted: [...done] }, callStack: [...stack] });
      if (arr[j] <= pivot) {
        i++;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        r.c.swaps++;
        r.push({ message: `Yes: increment i to ${i} and swap arr[${i}] with arr[${j}].`, vars: { low: lo, high: hi, pivot, i, j }, array: arr, hl: { swap: [i, j], pivot: hi, range: [lo, hi], sorted: [...done] }, callStack: [...stack] });
      }
    }
    [arr[i + 1], arr[hi]] = [arr[hi], arr[i + 1]];
    r.c.swaps++;
    done.add(i + 1);
    r.push({ message: `Place pivot ${pivot} at its final index ${i + 1}.`, vars: { low: lo, high: hi, pivot, p: i + 1 }, array: arr, hl: { swap: [i + 1, hi], sorted: [...done], range: [lo, hi] }, callStack: [...stack] });
    return i + 1;
  };
  const qs = (lo: number, hi: number) => {
    stack.push(`quick_sort(${lo}, ${hi})`);
    r.c.iterations++;
    if (lo < hi) {
      const p = part(lo, hi);
      qs(lo, p - 1);
      qs(p + 1, hi);
    } else if (lo === hi) done.add(lo);
    stack.pop();
  };
  qs(0, arr.length - 1);
  r.push({ message: 'Sorting complete.', vars: {}, array: arr, hl: { sorted: range(0, arr.length) } });
  return r;
}

function heapSortT(arr: number[]): Recorder {
  const r = new Recorder();
  const n = arr.length;
  const sorted: number[] = [];
  const heapify = (size: number, i: number) => {
    let largest = i;
    const l = 2 * i + 1;
    const rr = 2 * i + 2;
    r.c.iterations++;
    if (l < size) {
      r.c.comparisons++;
      r.push({ message: `heapify(${i}): compare node ${arr[i]} with left child ${arr[l]}.`, vars: { i, left: l, right: rr, size }, array: arr, hl: { compare: [largest, l], sorted: [...sorted] } });
      if (arr[l] > arr[largest]) largest = l;
    }
    if (rr < size) {
      r.c.comparisons++;
      r.push({ message: `Compare current largest ${arr[largest]} with right child ${arr[rr]}.`, vars: { i, left: l, right: rr, largest, size }, array: arr, hl: { compare: [largest, rr], sorted: [...sorted] } });
      if (arr[rr] > arr[largest]) largest = rr;
    }
    if (largest !== i) {
      [arr[i], arr[largest]] = [arr[largest], arr[i]];
      r.c.swaps++;
      r.push({ message: `Swap ${arr[largest]} down and ${arr[i]} up to restore the heap.`, vars: { i, largest, size }, array: arr, hl: { swap: [i, largest], sorted: [...sorted] } });
      heapify(size, largest);
    }
  };
  r.push({ message: 'Phase 1: build a max-heap.', vars: { n }, array: arr, hl: {} });
  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) heapify(n, i);
  r.push({ message: `Max-heap built; the maximum ${arr[0]} is at the root.`, vars: { n }, array: arr, hl: { active: [0] } });
  for (let i = n - 1; i > 0; i--) {
    [arr[0], arr[i]] = [arr[i], arr[0]];
    r.c.swaps++;
    sorted.unshift(i);
    r.push({ message: `Move the maximum ${arr[i]} to index ${i}.`, vars: { i }, array: arr, hl: { swap: [0, i], sorted: [...sorted] } });
    heapify(i, 0);
  }
  r.push({ message: 'Sorting complete.', vars: {}, array: arr, hl: { sorted: range(0, n) } });
  return r;
}

// ------------------------------------------------------------------ searching
function linearT(arr: number[], target: number): Recorder {
  const r = new Recorder();
  r.push({ message: `Search for ${target} from left to right.`, vars: { target }, array: arr, hl: {} });
  for (let i = 0; i < arr.length; i++) {
    r.c.comparisons++;
    r.c.iterations++;
    r.push({ message: `Compare arr[${i}] = ${arr[i]} with ${target}.`, vars: { i, target }, array: arr, hl: { compare: [i], dim: range(0, i) } });
    if (arr[i] === target) {
      r.push({ message: `Found ${target} at index ${i}.`, vars: { i, target, result: i }, array: arr, hl: { found: [i], dim: range(0, i) } });
      return r;
    }
  }
  r.push({ message: `${target} is not in the array; return -1.`, vars: { target, result: -1 }, array: arr, hl: { dim: range(0, arr.length) } });
  return r;
}

function binaryT(arr: number[], target: number): Recorder {
  const r = new Recorder();
  const sortedArr = [...arr].sort((a, b) => a - b);
  const wasSorted = sortedArr.every((v, i) => v === arr[i]);
  arr = sortedArr;
  r.push({ message: wasSorted ? `Search for ${target} in the sorted array.` : `Binary search needs sorted input, so the array was sorted first.`, vars: { target }, array: arr, hl: {} });
  let low = 0;
  let high = arr.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    r.c.iterations++;
    r.c.comparisons++;
    const dim = [...range(0, low), ...range(high + 1, arr.length)];
    r.push({ message: `low = ${low}, high = ${high} → mid = ${mid}; compare arr[mid] = ${arr[mid]} with ${target}.`, vars: { low, high, mid, target }, array: arr, hl: { compare: [mid], range: [low, high], dim } });
    if (arr[mid] === target) {
      r.push({ message: `Found ${target} at index ${mid}.`, vars: { low, high, mid, result: mid }, array: arr, hl: { found: [mid], dim } });
      return r;
    }
    if (arr[mid] < target) {
      r.push({ message: `${arr[mid]} < ${target}: discard the left half (low = mid + 1).`, vars: { low, high, mid }, array: arr, hl: { range: [mid + 1, high], dim: [...range(0, mid + 1), ...range(high + 1, arr.length)] } });
      low = mid + 1;
    } else {
      r.push({ message: `${arr[mid]} > ${target}: discard the right half (high = mid - 1).`, vars: { low, high, mid }, array: arr, hl: { range: [low, mid - 1], dim: [...range(0, low), ...range(mid, arr.length)] } });
      high = mid - 1;
    }
  }
  r.push({ message: `Range is empty: ${target} is not present.`, vars: { low, high, result: -1 }, array: arr, hl: { dim: range(0, arr.length) } });
  return r;
}

// ------------------------------------------------------------------ graphs
const G6 = {
  nodes: [
    { id: 0, x: 80, y: 150 }, { id: 1, x: 220, y: 60 }, { id: 2, x: 220, y: 240 },
    { id: 3, x: 380, y: 60 }, { id: 4, x: 380, y: 240 }, { id: 5, x: 520, y: 150 },
  ],
  edges: [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 1, to: 3 }, { from: 1, to: 4 }, { from: 2, to: 4 }, { from: 3, to: 5 }, { from: 4, to: 5 }],
};
const G5W = {
  nodes: [{ id: 0, x: 80, y: 150 }, { id: 1, x: 260, y: 50 }, { id: 2, x: 260, y: 250 }, { id: 3, x: 420, y: 150 }, { id: 4, x: 560, y: 150 }],
  edges: [{ from: 0, to: 1, w: 6 }, { from: 0, to: 2, w: 1 }, { from: 1, to: 2, w: 3 }, { from: 1, to: 3, w: 1 }, { from: 2, to: 3, w: 5 }, { from: 3, to: 4, w: 3 }],
};
const adj = (g: typeof G6, u: number) =>
  g.edges.flatMap((e) => (e.from === u ? [e.to] : e.to === u ? [e.from] : [])).sort((a, b) => a - b);

function bfsT(start: number): Recorder {
  const r = new Recorder();
  const state: GraphView['state'] = {};
  const q: number[] = [start];
  const order: number[] = [];
  state[start] = 'queued';
  const view = (extra: Partial<GraphView> = {}): GraphView => ({ ...G6, state: { ...state }, container: { label: 'Queue', items: [...q] }, ...extra });
  r.push({ message: `Start BFS from vertex ${start}: mark it visited and enqueue it.`, vars: { start }, graph: view() });
  while (q.length) {
    const u = q.shift()!;
    state[u] = 'current';
    order.push(u);
    r.c.iterations++;
    r.push({ message: `Dequeue ${u} and visit it. Order so far: ${order.join(' → ')}.`, vars: { u, visited: order.join(',') }, graph: view() });
    for (const v of adj(G6, u)) {
      r.c.comparisons++;
      if (!state[v]) {
        state[v] = 'queued';
        q.push(v);
        r.push({ message: `Neighbour ${v} is unvisited: mark and enqueue it.`, vars: { u, v }, graph: view({ activeEdge: [u, v] }) });
      } else r.push({ message: `Neighbour ${v} was already discovered — skip.`, vars: { u, v }, graph: view({ activeEdge: [u, v] }) });
    }
    state[u] = 'done';
  }
  r.push({ message: `BFS complete. Visit order: ${order.join(' → ')}.`, vars: { order: order.join(' ') }, graph: view() });
  return r;
}

function dfsT(start: number): Recorder {
  const r = new Recorder();
  const state: GraphView['state'] = {};
  const order: number[] = [];
  const stack: string[] = [];
  const view = (extra: Partial<GraphView> = {}): GraphView => ({ ...G6, state: { ...state }, container: { label: 'Call stack', items: stack.map((s) => Number(s.replace(/\D/g, ''))) }, ...extra });
  const dfs = (u: number) => {
    stack.push(`dfs(${u})`);
    state[u] = 'current';
    order.push(u);
    r.c.iterations++;
    r.push({ message: `Visit ${u}. Order: ${order.join(' → ')}.`, vars: { u, depth: stack.length }, graph: view(), callStack: [...stack] });
    for (const v of adj(G6, u)) {
      r.c.comparisons++;
      if (!state[v]) {
        r.push({ message: `Go deeper: ${u} → ${v}.`, vars: { u, v }, graph: view({ activeEdge: [u, v] }), callStack: [...stack] });
        state[u] = 'visited';
        dfs(v);
        state[u] = 'current';
        r.push({ message: `Back at ${u} (backtracked from ${v}).`, vars: { u }, graph: view(), callStack: [...stack] });
      }
    }
    state[u] = 'done';
    stack.pop();
  };
  r.push({ message: `Start DFS from vertex ${start}.`, vars: { start }, graph: view() });
  dfs(start);
  r.push({ message: `DFS complete. Visit order: ${order.join(' → ')}.`, vars: { order: order.join(' ') }, graph: view() });
  return r;
}

function dijkstraT(src: number): Recorder {
  const r = new Recorder();
  const V = 5;
  const INF = Infinity;
  const dist = Array(V).fill(INF);
  const done = Array(V).fill(false);
  const state: GraphView['state'] = {};
  dist[src] = 0;
  const w = (u: number, v: number) => G5W.edges.find((e) => (e.from === u && e.to === v) || (e.from === v && e.to === u))?.w ?? 0;
  const view = (extra: Partial<GraphView> = {}): GraphView => ({ ...G5W, state: { ...state }, dist: Object.fromEntries(dist.map((d, i) => [i, d === INF ? '∞' : String(d)])), ...extra });
  r.push({ message: `Initialise: dist[${src}] = 0, all others ∞.`, vars: { source: src }, graph: view() });
  for (let c = 0; c < V; c++) {
    let u = -1;
    for (let i = 0; i < V; i++) if (!done[i] && (u === -1 || dist[i] < dist[u])) u = i;
    if (u === -1 || dist[u] === INF) break;
    done[u] = true;
    state[u] = 'current';
    r.c.iterations++;
    r.push({ message: `Pick the closest unfinished vertex ${u} (dist ${dist[u]}). Its distance is now final.`, vars: { u, 'dist[u]': dist[u] }, graph: view() });
    for (const v of adj(G5W as typeof G6, u)) {
      if (done[v]) continue;
      r.c.comparisons++;
      const nd = dist[u] + w(u, v);
      if (nd < dist[v]) {
        const old = dist[v] === INF ? '∞' : dist[v];
        dist[v] = nd;
        state[v] = 'queued';
        r.push({ message: `Relax ${u} → ${v}: ${dist[u]} + ${w(u, v)} = ${nd} < ${old}, update dist[${v}].`, vars: { u, v, 'new dist': nd }, graph: view({ activeEdge: [u, v] }) });
      } else r.push({ message: `Edge ${u} → ${v}: ${dist[u]} + ${w(u, v)} = ${nd} is not better than ${dist[v]}.`, vars: { u, v }, graph: view({ activeEdge: [u, v] }) });
    }
    state[u] = 'done';
  }
  r.push({ message: `Done. Shortest distances: ${dist.map((d, i) => `${i}:${d}`).join(', ')}.`, vars: {}, graph: view() });
  return r;
}

// ------------------------------------------------------------------ recursion
function factorialT(n: number): Recorder {
  const r = new Recorder();
  n = Math.max(0, Math.min(n, 12));
  const stack: string[] = [];
  const f = (k: number): number => {
    stack.push(`factorial(${k})`);
    r.c.iterations++;
    r.push({ message: `Call factorial(${k}).`, vars: { n: k, depth: stack.length }, callStack: [...stack] });
    let res: number;
    if (k <= 1) {
      res = 1;
      r.push({ message: `Base case: factorial(${k}) = 1.`, vars: { n: k, result: 1 }, callStack: [...stack] });
    } else {
      const sub = f(k - 1);
      res = k * sub;
      r.c.comparisons++;
      r.push({ message: `Return ${k} × ${sub} = ${res}.`, vars: { n: k, 'factorial(n-1)': sub, result: res }, callStack: [...stack] });
    }
    stack.pop();
    return res;
  };
  const v = f(n);
  r.push({ message: `Result: ${n}! = ${v}.`, vars: { result: v }, callStack: [] });
  return r;
}

function fibT(n: number): Recorder {
  const r = new Recorder();
  n = Math.max(0, Math.min(n, 7));
  const stack: string[] = [];
  const memo: Record<string, number> = {};
  const f = (k: number): number => {
    stack.push(`fib(${k})`);
    r.c.iterations++;
    r.push({ message: `Call fib(${k})${memo[k] !== undefined ? ' — already computed before (naive recursion recomputes it!)' : ''}.`, vars: { n: k, depth: stack.length, calls: r.c.iterations }, callStack: [...stack], map: { ...memo } });
    let res: number;
    if (k <= 1) res = k;
    else res = f(k - 1) + f(k - 2);
    memo[k] = res;
    r.push({ message: `fib(${k}) returns ${res}.`, vars: { n: k, result: res, calls: r.c.iterations }, callStack: [...stack], map: { ...memo } });
    stack.pop();
    return res;
  };
  const v = f(n);
  r.push({ message: `fib(${n}) = ${v}, computed with ${r.c.iterations} calls. The iterative version needs only ${Math.max(0, n - 1)} loop iterations.`, vars: { result: v, calls: r.c.iterations }, callStack: [], map: memo });
  return r;
}

function hanoiT(n: number): Recorder {
  const r = new Recorder();
  n = Math.max(1, Math.min(n, 5));
  const rods: number[][] = [range(1, n + 1).reverse(), [], []];
  const names = ['A', 'B', 'C'];
  const stack: string[] = [];
  r.push({ message: `Move ${n} disks from A to C using B.`, vars: { n }, hanoi: { rods: rods.map((x) => [...x]) } });
  const h = (k: number, s: number, t: number, via: number) => {
    if (k === 0) return;
    stack.push(`hanoi(${k}, ${names[s]}, ${names[t]}, ${names[via]})`);
    h(k - 1, s, via, t);
    rods[t].push(rods[s].pop()!);
    r.c.iterations++;
    r.push({ message: `Move disk ${k} from ${names[s]} to ${names[t]}.`, vars: { disk: k, from: names[s], to: names[t], moves: r.c.iterations }, hanoi: { rods: rods.map((x) => [...x]), move: [s, t] }, callStack: [...stack] });
    h(k - 1, via, t, s);
    stack.pop();
  };
  h(n, 0, 2, 1);
  r.push({ message: `Done in ${r.c.iterations} moves (2^${n} - 1).`, vars: { moves: r.c.iterations }, hanoi: { rods } });
  return r;
}

// ------------------------------------------------------------------ arrays / DP
function kadaneT(arr: number[]): Recorder {
  const r = new Recorder();
  let cur = arr[0];
  let best = arr[0];
  let start = 0;
  let bestL = 0;
  let bestR = 0;
  r.push({ message: `Start: current = best = ${arr[0]}.`, vars: { i: 0, current: cur, best }, array: arr, hl: { active: [0], found: [0] } });
  for (let i = 1; i < arr.length; i++) {
    r.c.iterations++;
    r.c.comparisons++;
    if (arr[i] > cur + arr[i]) {
      cur = arr[i];
      start = i;
      r.push({ message: `${arr[i]} alone beats extending (${cur} > previous + ${arr[i]}): start a new subarray at ${i}.`, vars: { i, current: cur, best }, array: arr, hl: { range: [start, i], active: [i], found: range(bestL, bestR + 1) } });
    } else {
      cur = cur + arr[i];
      r.push({ message: `Extend the subarray with ${arr[i]}: current = ${cur}.`, vars: { i, current: cur, best }, array: arr, hl: { range: [start, i], active: [i], found: range(bestL, bestR + 1) } });
    }
    if (cur > best) {
      best = cur;
      bestL = start;
      bestR = i;
      r.push({ message: `New best sum ${best} for subarray [${bestL}..${bestR}].`, vars: { i, current: cur, best }, array: arr, hl: { found: range(bestL, bestR + 1) } });
    }
  }
  r.push({ message: `Maximum subarray sum = ${best} (indices ${bestL}..${bestR}).`, vars: { best }, array: arr, hl: { found: range(bestL, bestR + 1) } });
  return r;
}

function twoSumT(arr: number[], target: number): Recorder {
  const r = new Recorder();
  const seen: Record<string, number> = {};
  r.push({ message: `Find two numbers that add up to ${target}.`, vars: { target }, array: arr, map: {}, hl: {} });
  for (let i = 0; i < arr.length; i++) {
    const need = target - arr[i];
    r.c.iterations++;
    r.c.comparisons++;
    r.push({ message: `i = ${i}: need = ${target} - ${arr[i]} = ${need}. Is ${need} in the map?`, vars: { i, 'nums[i]': arr[i], need }, array: arr, map: { ...seen }, hl: { active: [i] } });
    if (seen[need] !== undefined) {
      r.push({ message: `Yes! ${need} was seen at index ${seen[need]}. Answer: [${seen[need]}, ${i}].`, vars: { i, need, answer: `${seen[need]}, ${i}` }, array: arr, map: { ...seen }, hl: { found: [seen[need], i] } });
      return r;
    }
    seen[String(arr[i])] = i;
    r.push({ message: `No. Store ${arr[i]} → ${i} in the map.`, vars: { i, need }, array: arr, map: { ...seen }, hl: { active: [i] } });
  }
  r.push({ message: 'No pair adds up to the target.', vars: {}, array: arr, map: seen, hl: {} });
  return r;
}

// ------------------------------------------------------------------ data structures
function parseOps(text: string, defaults: string): { op: string; val?: number }[] {
  const src = text.trim() ? text : defaults;
  return src
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20)
    .map((s) => {
      const m = s.match(/^([a-z]+)\s*(-?\d+)?/);
      return { op: m?.[1] ?? s, val: m?.[2] !== undefined ? Number(m[2]) : undefined };
    });
}

function stackT(text: string): Recorder {
  const r = new Recorder();
  const s: number[] = [];
  const CAP = 6;
  r.push({ message: `Empty stack (capacity ${CAP}). top = -1.`, vars: { top: -1 }, list: { kind: 'stack', items: [] } });
  for (const { op, val } of parseOps(text, 'push 10, push 20, push 30, pop, push 40, pop, pop')) {
    r.c.iterations++;
    if (op === 'push' && val !== undefined) {
      if (s.length >= CAP) r.push({ message: `push(${val}): overflow — the stack is full.`, vars: { top: s.length - 1 }, list: { kind: 'stack', items: [...s], op: 'overflow' } });
      else {
        s.push(val);
        r.push({ message: `push(${val}): top becomes ${s.length - 1}.`, vars: { top: s.length - 1, value: val }, list: { kind: 'stack', items: [...s], highlight: s.length - 1, op: 'push' } });
      }
    } else if (op === 'pop') {
      if (!s.length) r.push({ message: 'pop(): underflow — the stack is empty.', vars: { top: -1 }, list: { kind: 'stack', items: [], op: 'underflow' } });
      else {
        const v = s.pop()!;
        r.push({ message: `pop() returns ${v}.`, vars: { top: s.length - 1, popped: v }, list: { kind: 'stack', items: [...s], op: 'pop' } });
      }
    } else if (op === 'peek') r.push({ message: s.length ? `peek() = ${s[s.length - 1]}.` : 'peek() on empty stack.', vars: { top: s.length - 1 }, list: { kind: 'stack', items: [...s], highlight: s.length - 1 } });
  }
  return r;
}

function queueT(text: string): Recorder {
  const r = new Recorder();
  const q: number[] = [];
  r.push({ message: 'Empty queue.', vars: { size: 0 }, list: { kind: 'queue', items: [] } });
  for (const { op, val } of parseOps(text, 'enqueue 10, enqueue 20, enqueue 30, dequeue, enqueue 40, dequeue')) {
    r.c.iterations++;
    if ((op === 'enqueue' || op === 'push') && val !== undefined) {
      q.push(val);
      r.push({ message: `enqueue(${val}) at the rear.`, vars: { size: q.length, front: q[0], rear: q[q.length - 1] }, list: { kind: 'queue', items: [...q], highlight: q.length - 1, op: 'enqueue' } });
    } else if (op === 'dequeue' || op === 'pop') {
      if (!q.length) r.push({ message: 'dequeue(): underflow — the queue is empty.', vars: { size: 0 }, list: { kind: 'queue', items: [], op: 'underflow' } });
      else {
        const v = q.shift()!;
        r.push({ message: `dequeue() removes ${v} from the front.`, vars: { size: q.length, removed: v }, list: { kind: 'queue', items: [...q], op: 'dequeue' } });
      }
    }
  }
  return r;
}

function linkedT(text: string): Recorder {
  const r = new Recorder();
  const l: number[] = [];
  r.push({ message: 'Empty list: head = NULL.', vars: { size: 0 }, list: { kind: 'linked', items: [] } });
  for (const { op, val } of parseOps(text, 'tail 10, tail 20, tail 30, head 5, delete 20')) {
    if (val === undefined) continue;
    r.c.iterations++;
    if (op === 'head') {
      l.unshift(val);
      r.push({ message: `insertAtHead(${val}): new node points to the old head.`, vars: { size: l.length, head: l[0] }, list: { kind: 'linked', items: [...l], highlight: 0, op: 'insert' } });
    } else if (op === 'tail' || op === 'insert' || op === 'append') {
      for (let i = 0; i < l.length; i++) {
        r.c.comparisons++;
        r.push({ message: `Walk to the last node: at ${l[i]}.`, vars: { cur: l[i] }, list: { kind: 'linked', items: [...l], highlight: i } });
      }
      l.push(val);
      r.push({ message: `insertAtTail(${val}): link it after the last node.`, vars: { size: l.length }, list: { kind: 'linked', items: [...l], highlight: l.length - 1, op: 'insert' } });
    } else if (op === 'delete' || op === 'remove') {
      const idx = l.indexOf(val);
      for (let i = 0; i <= (idx < 0 ? l.length - 1 : idx); i++) {
        r.c.comparisons++;
        r.push({ message: `Search for ${val}: check node ${l[i]}.`, vars: { cur: l[i] }, list: { kind: 'linked', items: [...l], highlight: i } });
      }
      if (idx >= 0) {
        l.splice(idx, 1);
        r.push({ message: `Unlink node ${val}: its predecessor now points to its successor.`, vars: { size: l.length }, list: { kind: 'linked', items: [...l], op: 'delete' } });
      } else r.push({ message: `${val} is not in the list.`, vars: { size: l.length }, list: { kind: 'linked', items: [...l] } });
    }
  }
  return r;
}

function bstT(keys: number[], target: number): Recorder {
  const r = new Recorder();
  type N = { id: number; key: number; left: N | null; right: N | null; parent: number | null };
  let root: N | null = null;
  const all: N[] = [];
  const layout = () => {
    const out: NonNullable<TraceStep['tree']>['nodes'] = [];
    const walk = (n: N | null, depth: number, lo: number, hi: number) => {
      if (!n) return;
      const x = (lo + hi) / 2;
      out.push({ id: n.id, key: n.key, x, y: 40 + depth * 70, parent: n.parent });
      walk(n.left, depth + 1, lo, x);
      walk(n.right, depth + 1, x, hi);
    };
    walk(root, 0, 0, 600);
    return out;
  };
  for (const key of keys.slice(0, 12)) {
    r.c.iterations++;
    const path: number[] = [];
    if (!root) {
      root = { id: all.length, key, left: null, right: null, parent: null };
      all.push(root);
      r.push({ message: `Insert ${key}: the tree is empty, so it becomes the root.`, vars: { key }, tree: { nodes: layout(), highlight: root.id } });
      continue;
    }
    let cur: N = root;
    for (;;) {
      path.push(cur.id);
      r.c.comparisons++;
      r.push({ message: `Insert ${key}: compare with ${cur.key} → go ${key < cur.key ? 'left' : 'right'}.`, vars: { key, node: cur.key }, tree: { nodes: layout(), highlight: cur.id, path: [...path] } });
      const dir: 'left' | 'right' = key < cur.key ? 'left' : 'right';
      if (!cur[dir]) {
        const n: N = { id: all.length, key, left: null, right: null, parent: cur.id };
        all.push(n);
        cur[dir] = n;
        r.push({ message: `Place ${key} as the ${dir} child of ${cur.key}.`, vars: { key }, tree: { nodes: layout(), highlight: n.id, path: [...path, n.id] } });
        break;
      }
      cur = cur[dir]!;
    }
  }
  // search
  let cur: N | null = root;
  const path: number[] = [];
  r.push({ message: `Search for ${target}.`, vars: { target }, tree: { nodes: layout() } });
  while (cur) {
    path.push(cur.id);
    r.c.comparisons++;
    if (cur.key === target) {
      r.push({ message: `Found ${target}.`, vars: { target }, tree: { nodes: layout(), path: [...path], found: cur.id } });
      return r;
    }
    r.push({ message: `${target} ${target < cur.key ? '<' : '>'} ${cur.key} → go ${target < cur.key ? 'left' : 'right'}.`, vars: { target, node: cur.key }, tree: { nodes: layout(), highlight: cur.id, path: [...path] } });
    cur = target < cur.key ? cur.left : cur.right;
  }
  r.push({ message: `Reached an empty subtree: ${target} is not in the tree.`, vars: { target }, tree: { nodes: layout(), path } });
  return r;
}

function hashT(keys: number[]): Recorder {
  const r = new Recorder();
  const SIZE = 7;
  const slots: number[][] = Array.from({ length: SIZE }, () => []);
  r.push({ message: `Empty table with ${SIZE} buckets; hash(key) = key mod ${SIZE}.`, vars: { size: SIZE }, buckets: { slots: slots.map((s) => [...s]) } });
  for (const k of keys.slice(0, 14)) {
    const idx = ((k % SIZE) + SIZE) % SIZE;
    r.c.iterations++;
    const collision = slots[idx].length > 0;
    if (collision) r.c.comparisons += slots[idx].length;
    slots[idx].push(k);
    r.push({ message: `hash(${k}) = ${k} mod ${SIZE} = ${idx}.${collision ? ' Collision! Append to the chain.' : ''}`, vars: { key: k, index: idx, load: (keys.indexOf(k) + 1) / SIZE }, buckets: { slots: slots.map((s) => [...s]), highlight: idx, hashOf: `${k} mod ${SIZE} = ${idx}` } });
  }
  return r;
}


// ------------------------------------------------------------------ Studio 2.0 additions
function countingT(arr: number[]): Recorder {
  const r = new Recorder();
  arr = arr.map((x) => Math.max(0, Math.min(30, Math.abs(x))));
  let k = 0;
  for (let i = 0; i < arr.length; i++) {
    r.c.comparisons++;
    if (arr[i] > k) k = arr[i];
    r.push({ message: `Scan for the maximum: arr[${i}] = ${arr[i]}, max so far k = ${k}.`, line: 4, vars: { i, k }, array: arr, hl: { active: [i] } });
  }
  const count = new Array(k + 1).fill(0);
  for (let i = 0; i < arr.length; i++) {
    count[arr[i]]++;
    r.c.iterations++;
    const shown: Record<string, number> = {};
    count.forEach((c, v) => c && (shown[String(v)] = c));
    r.push({ message: `Count ${arr[i]}: count[${arr[i]}] = ${count[arr[i]]}.`, line: 8, vars: { i, x: arr[i] }, array: arr, hl: { active: [i] }, map: shown });
  }
  const out = [...arr];
  let i = 0;
  const done: number[] = [];
  for (let v = 0; v <= k; v++) {
    while (count[v] > 0) {
      out[i] = v;
      done.push(i);
      count[v]--;
      r.c.iterations++;
      const shown: Record<string, number> = {};
      count.forEach((c, vv) => c && (shown[String(vv)] = c));
      r.push({ message: `Write ${v} at index ${i} (${count[v]} more ${v}'s to write).`, line: 12, vars: { v, i }, array: out, hl: { sorted: [...done], active: [i] }, map: shown });
      i++;
    }
  }
  r.push({ message: 'All counts written back — the array is sorted by counting, not by swapping elements.', vars: { k }, array: out, hl: { sorted: range(0, out.length) } });
  return r;
}

function shellT(arr: number[]): Recorder {
  const r = new Recorder();
  const n = arr.length;
  let gap = Math.floor(n / 2);
  r.push({ message: `n = ${n}; start with gap = ${gap}.`, vars: { n, gap }, array: arr, hl: {} });
  while (gap > 0) {
    for (let i = gap; i < n; i++) {
      const temp = arr[i];
      let j = i;
      r.c.iterations++;
      r.push({ message: `gap ${gap}: take arr[${i}] = ${temp} and insert it into its gap-${gap} sub-list.`, line: 6, vars: { gap, i, temp }, array: arr, hl: { active: [i] } });
      while (j >= gap) {
        r.c.comparisons++;
        if (arr[j - gap] <= temp) {
          r.push({ message: `arr[${j - gap}] = ${arr[j - gap]} ≤ ${temp}: position found.`, line: 8, vars: { gap, i, j, temp }, array: arr, hl: { compare: [j - gap, j] } });
          break;
        }
        arr[j] = arr[j - gap];
        r.c.swaps++;
        r.push({ message: `arr[${j - gap}] = ${arr[j - gap]} > ${temp}: shift it ${gap} places right.`, line: 9, vars: { gap, i, j, temp }, array: arr, hl: { swap: [j - gap, j] } });
        j -= gap;
      }
      arr[j] = temp;
      r.push({ message: `Place ${temp} at index ${j}.`, line: 11, vars: { gap, i, j, temp }, array: arr, hl: { found: [j] } });
    }
    gap = Math.floor(gap / 2);
    r.push({ message: gap ? `Halve the gap: gap = ${gap}.` : 'Gap reached 0 — the array is sorted.', line: 12, vars: { gap }, array: arr, hl: gap ? {} : { sorted: range(0, n) } });
  }
  return r;
}

function jumpT(arr: number[], target: number): Recorder {
  const r = new Recorder();
  const sorted = [...arr].sort((a, b) => a - b);
  const wasSorted = sorted.every((v, i) => v === arr[i]);
  arr = sorted;
  const n = arr.length;
  let block = 0;
  while ((block + 1) * (block + 1) <= n) block++;
  r.push({ message: `${wasSorted ? '' : 'Jump search needs sorted input, so the array was sorted first. '}n = ${n}, jump size = ⌊√${n}⌋ = ${block}.`, vars: { n, block, target }, array: arr, hl: {} });
  let step = block;
  let prev = 0;
  for (;;) {
    const probe = Math.min(step, n) - 1;
    r.c.comparisons++;
    r.c.iterations++;
    if (arr[probe] >= target) {
      r.push({ message: `arr[${probe}] = ${arr[probe]} ≥ ${target}: the target can only be in block [${prev}, ${probe}].`, line: 13, vars: { prev, step, target }, array: arr, hl: { compare: [probe], range: [prev, probe], dim: [...range(0, prev), ...range(probe + 1, n)] } });
      break;
    }
    r.push({ message: `arr[${probe}] = ${arr[probe]} < ${target}: jump ahead ${block} positions.`, line: 14, vars: { prev, step, target }, array: arr, hl: { compare: [probe], dim: range(0, probe + 1) } });
    prev = step;
    step += block;
    if (prev >= n) {
      r.push({ message: `Jumped past the end: ${target} is not present.`, vars: { prev, result: -1 }, array: arr, hl: { dim: range(0, n) } });
      return r;
    }
  }
  const end = Math.min(step, n);
  while (prev < end) {
    r.c.comparisons++;
    if (arr[prev] === target) {
      r.push({ message: `Linear scan: arr[${prev}] = ${target}. Found at index ${prev}.`, line: 22, vars: { prev, result: prev }, array: arr, hl: { found: [prev] } });
      return r;
    }
    if (arr[prev] > target) break;
    r.push({ message: `Linear scan: arr[${prev}] = ${arr[prev]} < ${target}, move right.`, line: 18, vars: { prev, target }, array: arr, hl: { compare: [prev], range: [prev, end - 1] } });
    prev++;
  }
  r.push({ message: `${target} is not in the block, so it is not present (-1).`, vars: { result: -1 }, array: arr, hl: { dim: range(0, n) } });
  return r;
}

function traversalT(values: number[], order: string): Recorder {
  const r = new Recorder();
  const tree = values.slice(0, 15);
  const kind = /pre/i.test(order) ? 'preorder' : /post/i.test(order) ? 'postorder' : 'inorder';
  const depthOf = (i: number) => Math.floor(Math.log2(i + 1));
  const nodes = tree.map((key, i) => {
    const d = depthOf(i);
    const pos = i - (2 ** d - 1);
    const slots = 2 ** d;
    return { id: i, key, x: ((pos + 0.5) / slots) * 600, y: 40 + d * 70, parent: i === 0 ? null : Math.floor((i - 1) / 2) };
  });
  const visited: number[] = [];
  const stack: string[] = [];
  r.push({ message: `${kind[0].toUpperCase()}${kind.slice(1)} traversal of a ${tree.length}-node tree stored in an array (children of i are 2i+1 and 2i+2).`, vars: { order: kind }, tree: { nodes } });
  const visit = (i: number) => {
    visited.push(i);
    r.c.comparisons++;
    r.push({ message: `Visit ${tree[i]} → output so far: ${visited.map((v) => tree[v]).join(' ')}.`, vars: { i, node: tree[i], output: visited.map((v) => tree[v]).join(' ') }, tree: { nodes, highlight: i, path: [...visited] }, callStack: [...stack] });
  };
  const go = (i: number) => {
    if (i >= tree.length) return;
    stack.push(`${kind}(${tree[i]})`);
    r.c.iterations++;
    r.push({ message: `Call ${kind} on node ${tree[i]}.`, vars: { i, node: tree[i] }, tree: { nodes, highlight: i, path: [...visited] }, callStack: [...stack] });
    if (kind === 'preorder') visit(i);
    go(2 * i + 1);
    if (kind === 'inorder') visit(i);
    go(2 * i + 2);
    if (kind === 'postorder') visit(i);
    stack.pop();
  };
  go(0);
  r.push({ message: `${kind}: ${visited.map((v) => tree[v]).join(' ')}`, vars: { output: visited.map((v) => tree[v]).join(' ') }, tree: { nodes, path: [...visited] }, callStack: [] });
  return r;
}

function powerT(x: number, n: number): Recorder {
  const r = new Recorder();
  x = Math.max(-9, Math.min(9, x));
  n = Math.max(0, Math.min(30, n));
  const stack: string[] = [];
  const p = (b: number, e: number): number => {
    stack.push(`power(${b}, ${e})`);
    r.c.iterations++;
    r.push({ message: `Call power(${b}, ${e}).`, vars: { x: b, n: e, depth: stack.length }, callStack: [...stack] });
    let res: number;
    if (e === 0) {
      res = 1;
      r.push({ message: `Base case: power(${b}, 0) = 1.`, vars: { x: b, n: e, result: 1 }, callStack: [...stack] });
    } else if (e % 2 === 0) {
      const half = p(b, e / 2);
      res = half * half;
      r.c.comparisons++;
      r.push({ message: `${e} is even: power(${b}, ${e}) = ${half} × ${half} = ${res}.`, vars: { x: b, n: e, half, result: res }, callStack: [...stack] });
    } else {
      const sub = p(b, e - 1);
      res = b * sub;
      r.c.comparisons++;
      r.push({ message: `${e} is odd: power(${b}, ${e}) = ${b} × ${sub} = ${res}.`, vars: { x: b, n: e, result: res }, callStack: [...stack] });
    }
    stack.pop();
    return res;
  };
  const v = p(x, n);
  r.push({ message: `${x}^${n} = ${v} using ${r.c.comparisons} multiplications (the naive loop needs ${Math.max(0, n - 1)}).`, vars: { result: v, multiplications: r.c.comparisons }, callStack: [] });
  return r;
}

// ------------------------------------------------------------------ dispatcher
export function trace(id: string, input: string): TraceResult {
  const [left, right] = input.split('|');
  let r: Recorder;
  let usedInput = input;
  const nums = (fb: number[], max = 16) => parseNumbers(left ?? '', fb, max);
  const tgt = (fb: number) => {
    const n = parseNumbers(right ?? '', [fb], 1)[0];
    return n;
  };
  switch (id) {
    case 'bubble-sort':
      r = bubble(nums([64, 34, 25, 12, 22, 11, 90]));
      break;
    case 'selection-sort':
      r = selection(nums([29, 10, 14, 37, 13]));
      break;
    case 'insertion-sort':
      r = insertion(nums([12, 11, 13, 5, 6]));
      break;
    case 'merge-sort':
      r = mergeSortT(nums([38, 27, 43, 3, 9, 82, 10]));
      break;
    case 'quick-sort':
      r = quickSortT(nums([10, 7, 8, 9, 1, 5]));
      break;
    case 'heap-sort':
      r = heapSortT(nums([12, 11, 13, 5, 6, 7]));
      break;
    case 'linear-search':
      r = linearT(nums([10, 23, 45, 70, 11, 15]), tgt(70));
      break;
    case 'binary-search':
      r = binaryT(nums([2, 5, 8, 12, 16, 23, 38, 56, 72, 91]), tgt(23));
      break;
    case 'bfs':
      r = bfsT(Math.min(5, Math.max(0, parseNumbers(input, [0], 1)[0])));
      break;
    case 'dfs':
      r = dfsT(Math.min(5, Math.max(0, parseNumbers(input, [0], 1)[0])));
      break;
    case 'dijkstra':
      r = dijkstraT(Math.min(4, Math.max(0, parseNumbers(input, [0], 1)[0])));
      break;
    case 'factorial':
      r = factorialT(parseNumbers(input, [5], 1)[0]);
      break;
    case 'fibonacci':
      r = fibT(parseNumbers(input, [5], 1)[0]);
      break;
    case 'recursion':
      r = hanoiT(parseNumbers(input, [3], 1)[0]);
      break;
    case 'kadane':
      r = kadaneT(nums([-2, 1, -3, 4, -1, 2, 1, -5, 4]));
      break;
    case 'two-sum':
      r = twoSumT(nums([2, 7, 11, 15]), tgt(9));
      break;
    case 'stack':
      r = stackT(input);
      break;
    case 'queue':
      r = queueT(input);
      break;
    case 'linked-list':
      r = linkedT(input);
      break;
    case 'bst':
      r = bstT(nums([50, 30, 70, 20, 40, 60, 80], 12), tgt(60));
      break;
    case 'hash-table':
      r = hashT(nums([10, 20, 15, 7, 24, 31]));
      break;
    case 'counting-sort':
      r = countingT(nums([4, 2, 2, 8, 3, 3, 1]));
      break;
    case 'shell-sort':
      r = shellT(nums([23, 12, 1, 8, 34, 54, 2, 3]));
      break;
    case 'jump-search':
      r = jumpT(nums([0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]), tgt(55));
      break;
    case 'tree-traversal':
      r = traversalT(nums([1, 2, 3, 4, 5, 6, 7], 15), right ?? 'inorder');
      break;
    case 'fast-power': {
      const both = parseNumbers(input, [2, 10], 2);
      r = powerT(both[0], both[1] ?? 10);
      break;
    }
    default:
      throw new Error(`No visualiser available for '${id}'`);
  }
  if (!input.trim()) usedInput = '';
  return { steps: r.steps, input: usedInput, truncated: r.truncated };
}
