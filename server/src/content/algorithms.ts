/**
 * Built-in algorithm library (offline educational content).
 *
 * Each entry has a hand-written Python reference implementation. For entries marked
 * `source: 'python'`, the C, C++, Java and JavaScript versions, the pseudocode and the
 * flowchart are produced by CodePilot's own offline translation pipeline and verified by
 * automated tests (tests/library.test.ts runs every generated program with real compilers).
 * Data-structure entries that rely on classes / hash maps ship hand-written code instead.
 */
import type { Lang } from '../engine/ir.js';
import { HANDWRITTEN } from './algorithms-handwritten.js';
import { EXTRA } from './algorithms-extra.js';

export type VisualKind = 'sort' | 'search' | 'graph' | 'stack' | 'queue' | 'linkedlist' | 'bst' | 'hash' | 'recursion' | 'kadane' | 'twosum' | 'hanoi' | 'traversal';

export interface AlgorithmDef {
  id: string;
  name: string;
  category: 'Searching' | 'Sorting' | 'Data Structures' | 'Graphs' | 'Recursion' | 'Dynamic Programming' | 'Arrays';
  summary: string;
  description: string;
  input: string;
  output: string;
  steps: string[];
  complexity: { best: string; average: string; worst: string; space: string; note?: string };
  example: { input: string; output: string; explanation: string };
  keywords: string[];
  visual: VisualKind;
  /** default input for the visualiser */
  defaultInput: string;
  /** function to use for flowchart / pseudocode */
  focus: string;
  python: string;
  expectedOutput: string;
  source: 'python' | 'handwritten';
  code?: Partial<Record<Lang, string>>;
  pseudocode?: string;
  flowchart?: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
}

const PRINT_ARRAY = `def print_array(arr):
    for x in arr:
        print(x, end=" ")
    print()
`;

const AUTO: AlgorithmDef[] = [
  {
    id: 'linear-search',
    name: 'Linear Search',
    category: 'Searching',
    difficulty: 'Easy',
    summary: 'Scan every element from left to right until the target is found.',
    description:
      'Linear search checks each element of the array in order and stops as soon as it finds the target. It works on unsorted data and is the simplest search algorithm, but it may need to inspect every element.',
    input: 'An array of n elements and a target value.',
    output: 'The index of the target, or -1 if it is not present.',
    steps: [
      'Start at index 0.',
      'Compare the current element with the target.',
      'If they are equal, return the current index.',
      'Otherwise move to the next index.',
      'If the end of the array is reached, return -1.',
    ],
    complexity: { best: 'O(1)', average: 'O(n)', worst: 'O(n)', space: 'O(1)' },
    example: { input: 'arr = [10, 23, 45, 70, 11, 15], target = 70', output: 'Found 70 at index 3', explanation: '10, 23 and 45 are compared first; the 4th comparison matches at index 3.' },
    keywords: ['linear search', 'sequential search', 'find element', 'search unsorted', 'search an element', 'find index of', 'search array'],
    visual: 'search',
    defaultInput: '10, 23, 45, 70, 11, 15 | 70',
    focus: 'linear_search',
    source: 'python',
    expectedOutput: 'Found 70 at index 3\n',
    python: `def linear_search(arr, target):
    for i in range(len(arr)):
        if arr[i] == target:
            return i
    return -1


arr = [10, 23, 45, 70, 11, 15]
target = 70
index = linear_search(arr, target)
if index != -1:
    print("Found", target, "at index", index)
else:
    print(target, "not found")
`,
  },
  {
    id: 'binary-search',
    name: 'Binary Search',
    category: 'Searching',
    difficulty: 'Easy',
    summary: 'Repeatedly halve a sorted search range.',
    description:
      'Binary search works on a sorted array. It compares the target with the middle element; if they differ, the half that cannot contain the target is discarded. Each comparison halves the remaining range, giving logarithmic time.',
    input: 'A sorted array of n elements and a target value.',
    output: 'The index of the target, or -1 if it is not present.',
    steps: [
      'Set low = 0 and high = n - 1.',
      'While low ≤ high, compute mid = (low + high) / 2.',
      'If arr[mid] equals the target, return mid.',
      'If arr[mid] is smaller than the target, search the right half (low = mid + 1).',
      'Otherwise search the left half (high = mid - 1).',
      'If the range becomes empty, return -1.',
    ],
    complexity: { best: 'O(1)', average: 'O(log n)', worst: 'O(log n)', space: 'O(1)', note: 'Requires sorted input.' },
    example: { input: 'arr = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91], target = 23', output: 'Found 23 at index 5', explanation: 'mid=4 (16) < 23 → right half; mid=7 (56) > 23 → left half; mid=5 (23) → found.' },
    keywords: ['binary search', 'sorted array search', 'divide search', 'log n search', 'half interval', 'search sorted'],
    visual: 'search',
    defaultInput: '2, 5, 8, 12, 16, 23, 38, 56, 72, 91 | 23',
    focus: 'binary_search',
    source: 'python',
    expectedOutput: 'Found 23 at index 5\n',
    python: `def binary_search(arr, target):
    low = 0
    high = len(arr) - 1
    while low <= high:
        mid = (low + high) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1


arr = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91]
target = 23
index = binary_search(arr, target)
if index != -1:
    print("Found", target, "at index", index)
else:
    print(target, "not found")
`,
  },
  {
    id: 'bubble-sort',
    name: 'Bubble Sort',
    category: 'Sorting',
    difficulty: 'Easy',
    summary: 'Repeatedly swap adjacent elements that are out of order.',
    description:
      'Bubble sort makes passes over the array, comparing neighbours and swapping them when they are in the wrong order. After each pass the largest remaining element "bubbles" to its final position. An early-exit flag stops the algorithm when a pass makes no swaps.',
    input: 'An array of n comparable elements.',
    output: 'The same array sorted in ascending order.',
    steps: [
      'Repeat for pass i = 0 … n-2.',
      'Compare each pair arr[j], arr[j+1] for j = 0 … n-2-i.',
      'Swap them if arr[j] > arr[j+1].',
      'If a full pass makes no swap, the array is sorted — stop early.',
    ],
    complexity: { best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)', note: 'Stable, in-place.' },
    example: { input: '[64, 34, 25, 12, 22, 11, 90]', output: '11 12 22 25 34 64 90', explanation: 'After pass 1 the largest value 90 is last; after each further pass the next largest settles.' },
    keywords: ['bubble sort', 'sort array', 'sorting', 'adjacent swap', 'ascending order'],
    visual: 'sort',
    defaultInput: '64, 34, 25, 12, 22, 11, 90',
    focus: 'bubble_sort',
    source: 'python',
    expectedOutput: '11 12 22 25 34 64 90 \n',
    python: `def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        swapped = False
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                temp = arr[j]
                arr[j] = arr[j + 1]
                arr[j + 1] = temp
                swapped = True
        if not swapped:
            break


${PRINT_ARRAY}

arr = [64, 34, 25, 12, 22, 11, 90]
bubble_sort(arr)
print_array(arr)
`,
  },
  {
    id: 'selection-sort',
    name: 'Selection Sort',
    category: 'Sorting',
    difficulty: 'Easy',
    summary: 'Select the minimum of the unsorted part and move it to the front.',
    description:
      'Selection sort divides the array into a sorted prefix and an unsorted suffix. On each pass it finds the smallest element of the unsorted part and swaps it into the next position of the sorted prefix. It always performs O(n²) comparisons but at most n-1 swaps.',
    input: 'An array of n comparable elements.',
    output: 'The array sorted in ascending order.',
    steps: [
      'For i = 0 … n-2, assume arr[i] is the minimum.',
      'Scan j = i+1 … n-1 and remember the index of the smallest element.',
      'Swap the smallest element with arr[i].',
      'The prefix arr[0..i] is now sorted.',
    ],
    complexity: { best: 'O(n²)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)', note: 'Not stable; minimal number of swaps.' },
    example: { input: '[29, 10, 14, 37, 13]', output: '10 13 14 29 37', explanation: '10 is selected first and swapped with 29, then 13, and so on.' },
    keywords: ['selection sort', 'find minimum and swap', 'sort array', 'sorting'],
    visual: 'sort',
    defaultInput: '29, 10, 14, 37, 13',
    focus: 'selection_sort',
    source: 'python',
    expectedOutput: '10 13 14 29 37 \n',
    python: `def selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_index = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_index]:
                min_index = j
        temp = arr[i]
        arr[i] = arr[min_index]
        arr[min_index] = temp


${PRINT_ARRAY}

arr = [29, 10, 14, 37, 13]
selection_sort(arr)
print_array(arr)
`,
  },
  {
    id: 'insertion-sort',
    name: 'Insertion Sort',
    category: 'Sorting',
    difficulty: 'Easy',
    summary: 'Insert each element into its place in the sorted prefix.',
    description:
      'Insertion sort builds the sorted array one element at a time. The current element (the key) is compared with elements of the sorted prefix from right to left; larger elements are shifted one position to the right and the key is inserted into the gap. It is very fast on nearly sorted data.',
    input: 'An array of n comparable elements.',
    output: 'The array sorted in ascending order.',
    steps: [
      'For i = 1 … n-1, store key = arr[i].',
      'Set j = i - 1.',
      'While j ≥ 0 and arr[j] > key, shift arr[j] to arr[j+1] and decrease j.',
      'Place the key at arr[j+1].',
    ],
    complexity: { best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)', note: 'Stable, in-place, adaptive.' },
    example: { input: '[12, 11, 13, 5, 6]', output: '5 6 11 12 13', explanation: '11 is inserted before 12, 13 stays, 5 shifts three elements, 6 shifts three elements.' },
    keywords: ['insertion sort', 'insert into sorted', 'sort array', 'sorting', 'nearly sorted'],
    visual: 'sort',
    defaultInput: '12, 11, 13, 5, 6',
    focus: 'insertion_sort',
    source: 'python',
    expectedOutput: '5 6 11 12 13 \n',
    python: `def insertion_sort(arr):
    for i in range(1, len(arr)):
        key = arr[i]
        j = i - 1
        while j >= 0 and arr[j] > key:
            arr[j + 1] = arr[j]
            j -= 1
        arr[j + 1] = key


${PRINT_ARRAY}

arr = [12, 11, 13, 5, 6]
insertion_sort(arr)
print_array(arr)
`,
  },
  {
    id: 'merge-sort',
    name: 'Merge Sort',
    category: 'Sorting',
    difficulty: 'Medium',
    summary: 'Divide the array in halves, sort each half, then merge.',
    description:
      'Merge sort is a divide-and-conquer algorithm. It recursively splits the array into two halves until each part has one element, then merges the sorted halves back together. Merging two sorted lists takes linear time, and there are log n levels of splitting.',
    input: 'An array of n comparable elements.',
    output: 'The array sorted in ascending order.',
    steps: [
      'If the range has fewer than two elements, it is already sorted.',
      'Find the middle index and recursively sort the left and right halves.',
      'Merge: repeatedly copy the smaller front element of the two halves into a temporary list.',
      'Copy any remaining elements, then write the merged list back.',
    ],
    complexity: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(n)', note: 'Stable; needs an auxiliary array.' },
    example: { input: '[38, 27, 43, 3, 9, 82, 10]', output: '3 9 10 27 38 43 82', explanation: '[38,27,43,3] and [9,82,10] are sorted independently and merged.' },
    keywords: ['merge sort', 'divide and conquer sort', 'n log n sort', 'stable sort', 'sorting'],
    visual: 'sort',
    defaultInput: '38, 27, 43, 3, 9, 82, 10',
    focus: 'merge_sort',
    source: 'python',
    expectedOutput: '3 9 10 27 38 43 82 \n',
    python: `def merge(arr, left, mid, right):
    temp = []
    i = left
    j = mid + 1
    while i <= mid and j <= right:
        if arr[i] <= arr[j]:
            temp.append(arr[i])
            i += 1
        else:
            temp.append(arr[j])
            j += 1
    while i <= mid:
        temp.append(arr[i])
        i += 1
    while j <= right:
        temp.append(arr[j])
        j += 1
    for k in range(len(temp)):
        arr[left + k] = temp[k]


def merge_sort(arr, left, right):
    if left < right:
        mid = (left + right) // 2
        merge_sort(arr, left, mid)
        merge_sort(arr, mid + 1, right)
        merge(arr, left, mid, right)


${PRINT_ARRAY}

arr = [38, 27, 43, 3, 9, 82, 10]
merge_sort(arr, 0, len(arr) - 1)
print_array(arr)
`,
  },
  {
    id: 'quick-sort',
    name: 'Quick Sort',
    category: 'Sorting',
    difficulty: 'Medium',
    summary: 'Partition around a pivot, then sort both sides recursively.',
    description:
      'Quick sort chooses a pivot (here the last element) and partitions the array so that smaller elements come before it and larger elements after it (Lomuto partition scheme). The pivot is then in its final place and both sides are sorted recursively. It is usually the fastest comparison sort in practice.',
    input: 'An array of n comparable elements.',
    output: 'The array sorted in ascending order.',
    steps: [
      'If low < high, partition the range around pivot = arr[high].',
      'Partition: keep index i of the last element ≤ pivot; for each j, if arr[j] ≤ pivot, increment i and swap arr[i], arr[j].',
      'Swap the pivot into position i + 1.',
      'Recursively sort the left part (low … p-1) and right part (p+1 … high).',
    ],
    complexity: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n²)', space: 'O(log n)', note: 'Worst case on already-sorted input with a last-element pivot.' },
    example: { input: '[10, 7, 8, 9, 1, 5]', output: '1 5 7 8 9 10', explanation: 'Pivot 5 ends at index 1 after the first partition: [1, 5, 8, 9, 10, 7].' },
    keywords: ['quick sort', 'quicksort', 'partition', 'pivot', 'sorting', 'divide and conquer'],
    visual: 'sort',
    defaultInput: '10, 7, 8, 9, 1, 5',
    focus: 'partition',
    source: 'python',
    expectedOutput: '1 5 7 8 9 10 \n',
    python: `def partition(arr, low, high):
    pivot = arr[high]
    i = low - 1
    for j in range(low, high):
        if arr[j] <= pivot:
            i += 1
            temp = arr[i]
            arr[i] = arr[j]
            arr[j] = temp
    temp = arr[i + 1]
    arr[i + 1] = arr[high]
    arr[high] = temp
    return i + 1


def quick_sort(arr, low, high):
    if low < high:
        p = partition(arr, low, high)
        quick_sort(arr, low, p - 1)
        quick_sort(arr, p + 1, high)


${PRINT_ARRAY}

arr = [10, 7, 8, 9, 1, 5]
quick_sort(arr, 0, len(arr) - 1)
print_array(arr)
`,
  },
  {
    id: 'heap-sort',
    name: 'Heap Sort',
    category: 'Sorting',
    difficulty: 'Hard',
    summary: 'Build a max-heap, then repeatedly move the maximum to the end.',
    description:
      'Heap sort first rearranges the array into a max-heap (a complete binary tree where each parent is at least as large as its children, stored in the array itself). The root is the maximum; it is swapped with the last element, the heap shrinks by one, and heapify restores the heap property.',
    input: 'An array of n comparable elements.',
    output: 'The array sorted in ascending order.',
    steps: [
      'Build a max-heap by calling heapify on every non-leaf node from n/2 - 1 down to 0.',
      'Swap the root (maximum) with the last element of the heap.',
      'Reduce the heap size by one and heapify the root.',
      'Repeat until the heap has one element.',
    ],
    complexity: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(1)', note: 'In-place, not stable.' },
    example: { input: '[12, 11, 13, 5, 6, 7]', output: '5 6 7 11 12 13', explanation: 'The max-heap root 13 is moved to the end first, then 12, 11, …' },
    keywords: ['heap sort', 'heapsort', 'max heap', 'heapify', 'priority', 'sorting'],
    visual: 'sort',
    defaultInput: '12, 11, 13, 5, 6, 7',
    focus: 'heapify',
    source: 'python',
    expectedOutput: '5 6 7 11 12 13 \n',
    python: `def heapify(arr, n, i):
    largest = i
    left = 2 * i + 1
    right = 2 * i + 2
    if left < n and arr[left] > arr[largest]:
        largest = left
    if right < n and arr[right] > arr[largest]:
        largest = right
    if largest != i:
        temp = arr[i]
        arr[i] = arr[largest]
        arr[largest] = temp
        heapify(arr, n, largest)


def heap_sort(arr):
    n = len(arr)
    for i in range(n // 2 - 1, -1, -1):
        heapify(arr, n, i)
    for i in range(n - 1, 0, -1):
        temp = arr[0]
        arr[0] = arr[i]
        arr[i] = temp
        heapify(arr, i, 0)


${PRINT_ARRAY}

arr = [12, 11, 13, 5, 6, 7]
heap_sort(arr)
print_array(arr)
`,
  },
  {
    id: 'bfs',
    name: 'Breadth-First Search (BFS)',
    category: 'Graphs',
    difficulty: 'Medium',
    summary: 'Explore a graph level by level using a queue.',
    description:
      'BFS visits the start vertex, then all of its neighbours, then their unvisited neighbours, and so on. A queue keeps vertices in the order they were discovered, so vertices are processed in increasing distance (number of edges) from the start. This makes BFS the standard way to find shortest paths in unweighted graphs.',
    input: 'A graph (adjacency matrix with V vertices) and a start vertex.',
    output: 'The order in which the vertices are visited.',
    steps: [
      'Mark the start vertex visited and enqueue it.',
      'While the queue is not empty, dequeue a vertex u and output it.',
      'For every neighbour v of u that is not visited, mark it visited and enqueue it.',
    ],
    complexity: { best: 'O(V + E)', average: 'O(V + E)', worst: 'O(V²)', space: 'O(V)', note: 'O(V²) with an adjacency matrix, O(V + E) with adjacency lists.' },
    example: { input: '6 vertices, edges 0-1, 0-2, 1-3, 1-4, 2-4, 3-5, 4-5, start = 0', output: 'BFS order: 0 1 2 3 4 5', explanation: 'Level 0: {0}; level 1: {1, 2}; level 2: {3, 4}; level 3: {5}.' },
    keywords: ['bfs', 'breadth first search', 'level order', 'graph traversal', 'shortest path unweighted', 'queue graph'],
    visual: 'graph',
    defaultInput: '0',
    focus: 'bfs',
    source: 'python',
    expectedOutput: 'BFS order: 0 1 2 3 4 5 \n',
    python: `graph = [
    [0, 1, 1, 0, 0, 0],
    [1, 0, 0, 1, 1, 0],
    [1, 0, 0, 0, 1, 0],
    [0, 1, 0, 0, 0, 1],
    [0, 1, 1, 0, 0, 1],
    [0, 0, 0, 1, 1, 0],
]
V = 6


def bfs(start):
    visited = [False] * V
    queue = [0] * V
    head = 0
    tail = 0
    visited[start] = True
    queue[tail] = start
    tail += 1
    print("BFS order:", end=" ")
    while head < tail:
        u = queue[head]
        head += 1
        print(u, end=" ")
        for v in range(V):
            if graph[u][v] == 1 and not visited[v]:
                visited[v] = True
                queue[tail] = v
                tail += 1
    print()


bfs(0)
`,
  },
  {
    id: 'dfs',
    name: 'Depth-First Search (DFS)',
    category: 'Graphs',
    difficulty: 'Medium',
    summary: 'Go as deep as possible along each branch before backtracking.',
    description:
      'DFS starts at a vertex and keeps following an unvisited neighbour until it reaches a dead end, then backtracks to the most recent vertex that still has unvisited neighbours. The recursion stack (or an explicit stack) remembers the path. DFS is used for cycle detection, topological sorting and connected components.',
    input: 'A graph (adjacency matrix with V vertices) and a start vertex.',
    output: 'The order in which vertices are visited.',
    steps: [
      'Mark the current vertex visited and output it.',
      'For each neighbour v of the current vertex, in order:',
      'If v is not visited, recursively run DFS from v.',
      'When all neighbours are done, return (backtrack).',
    ],
    complexity: { best: 'O(V + E)', average: 'O(V + E)', worst: 'O(V²)', space: 'O(V)', note: 'O(V²) with an adjacency matrix.' },
    example: { input: 'Same graph as BFS, start = 0', output: 'DFS order: 0 1 3 5 4 2', explanation: '0 → 1 → 3 → 5 → 4 → 2: DFS keeps going deeper before visiting 2.' },
    keywords: ['dfs', 'depth first search', 'graph traversal', 'backtracking', 'recursive traversal'],
    visual: 'graph',
    defaultInput: '0',
    focus: 'dfs',
    source: 'python',
    expectedOutput: 'DFS order: 0 1 3 5 4 2 \n',
    python: `graph = [
    [0, 1, 1, 0, 0, 0],
    [1, 0, 0, 1, 1, 0],
    [1, 0, 0, 0, 1, 0],
    [0, 1, 0, 0, 0, 1],
    [0, 1, 1, 0, 0, 1],
    [0, 0, 0, 1, 1, 0],
]
V = 6
visited = [False, False, False, False, False, False]


def dfs(u):
    visited[u] = True
    print(u, end=" ")
    for v in range(V):
        if graph[u][v] == 1 and not visited[v]:
            dfs(v)


print("DFS order:", end=" ")
dfs(0)
print()
`,
  },
  {
    id: 'dijkstra',
    name: "Dijkstra's Algorithm",
    category: 'Graphs',
    difficulty: 'Hard',
    summary: 'Shortest paths from one source in a graph with non-negative weights.',
    description:
      "Dijkstra's algorithm keeps a tentative distance for every vertex (∞ initially, 0 for the source). It repeatedly picks the unvisited vertex with the smallest distance, marks it final, and relaxes its outgoing edges: if going through it gives a shorter path to a neighbour, the neighbour's distance is updated. This simple O(V²) version uses an adjacency matrix; a priority queue gives O((V + E) log V).",
    input: 'A weighted graph (adjacency matrix, 0 = no edge) and a source vertex.',
    output: 'The shortest distance from the source to every vertex.',
    steps: [
      'Set dist[source] = 0 and every other distance to infinity.',
      'Repeat V times: pick the unvisited vertex u with the smallest dist.',
      'Mark u visited.',
      'For each neighbour v of u: if dist[u] + w(u, v) < dist[v], update dist[v].',
      'Output dist.',
    ],
    complexity: { best: 'O(V²)', average: 'O(V²)', worst: 'O(V²)', space: 'O(V)', note: 'Edge weights must be non-negative.' },
    example: { input: '5 vertices, source 0', output: 'Vertex 0: 0, Vertex 1: 4, Vertex 2: 1, Vertex 3: 5, Vertex 4: 8', explanation: 'The path 0 → 2 → 1 (1 + 3 = 4) is shorter than the direct edge 0 → 1 (weight 6).' },
    keywords: ['dijkstra', 'shortest path', 'weighted graph', 'single source shortest path', 'minimum distance'],
    visual: 'graph',
    defaultInput: '0',
    focus: 'dijkstra',
    source: 'python',
    expectedOutput: 'Vertex 0: 0\nVertex 1: 4\nVertex 2: 1\nVertex 3: 5\nVertex 4: 8\n',
    python: `graph = [
    [0, 6, 1, 0, 0],
    [6, 0, 3, 1, 0],
    [1, 3, 0, 5, 0],
    [0, 1, 5, 0, 3],
    [0, 0, 0, 3, 0],
]
V = 5
INF = 1000000


def dijkstra(src):
    dist = [INF] * V
    done = [False] * V
    dist[src] = 0
    for count in range(V):
        u = -1
        for i in range(V):
            if not done[i] and (u == -1 or dist[i] < dist[u]):
                u = i
        done[u] = True
        for v in range(V):
            if graph[u][v] > 0 and not done[v] and dist[u] + graph[u][v] < dist[v]:
                dist[v] = dist[u] + graph[u][v]
    for i in range(V):
        print(f"Vertex {i}: {dist[i]}")


dijkstra(0)
`,
  },
  {
    id: 'recursion',
    name: 'Recursion — Tower of Hanoi',
    category: 'Recursion',
    difficulty: 'Medium',
    summary: 'Solve a problem by reducing it to smaller copies of itself.',
    description:
      'A recursive function calls itself on a smaller instance of the same problem until it reaches a base case that can be answered directly. The Tower of Hanoi moves n disks from one rod to another: move n-1 disks out of the way, move the largest disk, then move the n-1 disks on top of it. The call stack keeps track of the pending work.',
    input: 'Number of disks n and the names of the three rods.',
    output: 'The sequence of moves (2ⁿ - 1 moves).',
    steps: [
      'Base case: if n == 0 there is nothing to move.',
      'Move n-1 disks from the source rod to the helper rod.',
      'Move disk n from the source rod to the target rod.',
      'Move the n-1 disks from the helper rod to the target rod.',
    ],
    complexity: { best: 'O(2ⁿ)', average: 'O(2ⁿ)', worst: 'O(2ⁿ)', space: 'O(n)', note: 'Recursion depth n.' },
    example: { input: 'n = 3', output: '7 moves', explanation: 'Move disk 1 A→C, disk 2 A→B, disk 1 C→B, disk 3 A→C, disk 1 B→A, disk 2 B→C, disk 1 A→C.' },
    keywords: ['recursion', 'tower of hanoi', 'hanoi', 'recursive function', 'base case'],
    visual: 'hanoi',
    defaultInput: '3',
    focus: 'hanoi',
    source: 'python',
    expectedOutput:
      'Move disk 1 from A to C\nMove disk 2 from A to B\nMove disk 1 from C to B\nMove disk 3 from A to C\nMove disk 1 from B to A\nMove disk 2 from B to C\nMove disk 1 from A to C\n',
    python: `def hanoi(n, source, target, helper):
    if n == 0:
        return
    hanoi(n - 1, source, helper, target)
    print("Move disk", n, "from", source, "to", target)
    hanoi(n - 1, helper, target, source)


hanoi(3, "A", "C", "B")
`,
  },
  {
    id: 'fibonacci',
    name: 'Fibonacci Numbers',
    category: 'Dynamic Programming',
    difficulty: 'Easy',
    summary: 'Each number is the sum of the two before it — recursion vs. iteration.',
    description:
      'The Fibonacci sequence starts 0, 1 and each later term is the sum of the previous two. The naive recursive definition recomputes the same values exponentially many times; the iterative (bottom-up dynamic programming) version keeps only the last two values and runs in linear time. Both are shown here.',
    input: 'A non-negative integer n.',
    output: 'The n-th Fibonacci number (and the first n terms).',
    steps: [
      'Base cases: fib(0) = 0, fib(1) = 1.',
      'Recursive: fib(n) = fib(n-1) + fib(n-2).',
      'Iterative: keep a = fib(i-2) and b = fib(i-1); repeat c = a + b, a = b, b = c.',
    ],
    complexity: { best: 'O(n)', average: 'O(n)', worst: 'O(n)', space: 'O(1)', note: 'Naive recursion is O(2ⁿ) time and O(n) stack space.' },
    example: { input: 'n = 10', output: '0 1 1 2 3 5 8 13 21 34 and fib(10) = 55', explanation: 'Every term after the first two is the sum of the two terms before it.' },
    keywords: ['fibonacci', 'fibonacci series', 'fibonacci sequence', 'nth fibonacci', 'dynamic programming', 'memoization'],
    visual: 'recursion',
    defaultInput: '5',
    focus: 'fib_iterative',
    source: 'python',
    expectedOutput: '0 1 1 2 3 5 8 13 21 34 \nfib(10) recursive = 55\nfib(10) iterative = 55\n',
    python: `def fib_recursive(n):
    if n <= 1:
        return n
    return fib_recursive(n - 1) + fib_recursive(n - 2)


def fib_iterative(n):
    if n <= 1:
        return n
    a = 0
    b = 1
    for i in range(2, n + 1):
        c = a + b
        a = b
        b = c
    return b


for i in range(10):
    print(fib_iterative(i), end=" ")
print()
print("fib(10) recursive =", fib_recursive(10))
print("fib(10) iterative =", fib_iterative(10))
`,
  },
  {
    id: 'factorial',
    name: 'Factorial',
    category: 'Recursion',
    difficulty: 'Easy',
    summary: 'n! = n × (n-1) × … × 1, computed recursively.',
    description:
      'The factorial of n is the product of all positive integers up to n, with 0! = 1. It is the classic first example of recursion: n! = n × (n-1)!. Each call waits for the smaller call to return, so the call stack grows to depth n. Use a 64-bit integer — factorials grow very quickly (20! is the largest that fits in a signed 64-bit integer).',
    input: 'A non-negative integer n.',
    output: 'n!',
    steps: ['Base case: if n ≤ 1 return 1.', 'Otherwise return n × factorial(n - 1).', 'The multiplications happen while the recursion unwinds.'],
    complexity: { best: 'O(n)', average: 'O(n)', worst: 'O(n)', space: 'O(n)', note: 'An iterative loop needs only O(1) space.' },
    example: { input: 'n = 5', output: '120', explanation: '5 × 4 × 3 × 2 × 1 = 120.' },
    keywords: ['factorial', 'n!', 'recursive factorial', 'product of numbers'],
    visual: 'recursion',
    defaultInput: '5',
    focus: 'factorial',
    source: 'python',
    expectedOutput: '5! = 120\n10! = 3628800\n',
    python: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)


print("5! =", factorial(5))
print("10! =", factorial(10))
`,
  },
  {
    id: 'kadane',
    name: "Kadane's Algorithm",
    category: 'Dynamic Programming',
    difficulty: 'Medium',
    summary: 'Maximum-sum contiguous subarray in one pass.',
    description:
      "Kadane's algorithm scans the array once while tracking the best sum of a subarray that ends at the current position. At each element it decides whether to extend the previous subarray or start a new one at the current element, and records the best value seen so far. It is a textbook example of dynamic programming with O(1) memory.",
    input: 'An array of n integers (may contain negatives).',
    output: 'The maximum possible sum of a non-empty contiguous subarray.',
    steps: [
      'Set current = best = arr[0].',
      'For each next element x: current = max(x, current + x).',
      'best = max(best, current).',
      'Return best.',
    ],
    complexity: { best: 'O(n)', average: 'O(n)', worst: 'O(n)', space: 'O(1)' },
    example: { input: '[-2, 1, -3, 4, -1, 2, 1, -5, 4]', output: '6', explanation: 'The subarray [4, -1, 2, 1] has the largest sum, 6.' },
    keywords: ['kadane', 'maximum subarray', 'max subarray sum', 'largest sum contiguous subarray', 'maximum sum'],
    visual: 'kadane',
    defaultInput: '-2, 1, -3, 4, -1, 2, 1, -5, 4',
    focus: 'max_subarray',
    source: 'python',
    expectedOutput: 'Maximum subarray sum: 6\n',
    python: `def max_subarray(arr):
    current = arr[0]
    best = arr[0]
    for i in range(1, len(arr)):
        current = max(arr[i], current + arr[i])
        best = max(best, current)
    return best


arr = [-2, 1, -3, 4, -1, 2, 1, -5, 4]
print("Maximum subarray sum:", max_subarray(arr))
`,
  },
];

export const ALGORITHMS: AlgorithmDef[] = [...AUTO, ...HANDWRITTEN, ...EXTRA];

export function findAlgorithm(id: string): AlgorithmDef | undefined {
  return ALGORITHMS.find((a) => a.id === id);
}

/** Score how well a free-text problem statement matches an algorithm. */
export function matchAlgorithms(text: string): { algo: AlgorithmDef; score: number }[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9!+ ]/g, ' ').replace(/\s+/g, ' ')} `;
  const out: { algo: AlgorithmDef; score: number }[] = [];
  for (const a of ALGORITHMS) {
    let score = 0;
    for (const k of a.keywords) if (t.includes(` ${k} `) || t.includes(` ${k}`)) score += k.split(' ').length * 3;
    for (const w of a.name.toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 3)) if (t.includes(` ${w}`)) score += 2;
    if (score) out.push({ algo: a, score });
  }
  return out.sort((x, y) => y.score - x.score);
}
