/**
 * Algorithm Studio 2.0 additions. Python reference implementations; the other languages,
 * pseudocode and flowcharts are produced by the offline translation pipeline and every
 * generated program is compiled and executed by tests/library.test.ts.
 */
import type { AlgorithmDef } from './algorithms.js';

export const EXTRA: AlgorithmDef[] = [
  {
    id: 'counting-sort',
    name: 'Counting Sort',
    category: 'Sorting',
    difficulty: 'Easy',
    summary: 'Count how often each value occurs, then rebuild the array in order.',
    description:
      'Counting sort does not compare elements. It counts how many times each value appears in a small, known range (here 0 … max), then writes every value back as many times as it was counted. It runs in linear time O(n + k), where k is the size of the value range, but needs O(k) extra memory, so it suits small non-negative integers such as marks, ages or digits.',
    input: 'An array of n non-negative integers with a small maximum value k.',
    output: 'The array sorted in ascending order.',
    steps: ['Find the maximum value k.', 'Create a count array of size k + 1 filled with 0.', 'For every element x, increase count[x].', 'Walk v from 0 to k and write v back count[v] times.'],
    complexity: { best: 'O(n + k)', average: 'O(n + k)', worst: 'O(n + k)', space: 'O(k)', note: 'k is the largest value. Not comparison-based, so the O(n log n) lower bound does not apply.' },
    example: { input: '[4, 2, 2, 8, 3, 3, 1]', output: '[1, 2, 2, 3, 3, 4, 8]', explanation: 'count = [0,1,2,2,1,0,0,0,1]; writing each value count times gives the sorted array.' },
    keywords: ['counting sort', 'count sort', 'non comparison sort', 'linear time sort'],
    visual: 'sort',
    defaultInput: '4, 2, 2, 8, 3, 3, 1',
    focus: 'counting_sort',
    source: 'python',
    expectedOutput: 'Sorted: 1 2 2 3 3 4 8 \n',
    python: `def counting_sort(arr):
    k = 0
    for x in arr:
        if x > k:
            k = x
    count = [0] * (k + 1)
    for x in arr:
        count[x] += 1
    i = 0
    for v in range(k + 1):
        while count[v] > 0:
            arr[i] = v
            i += 1
            count[v] -= 1


arr = [4, 2, 2, 8, 3, 3, 1]
counting_sort(arr)
print("Sorted:", end=" ")
for x in arr:
    print(x, end=" ")
print()
`,
  },
  {
    id: 'shell-sort',
    name: 'Shell Sort',
    category: 'Sorting',
    difficulty: 'Medium',
    summary: 'Insertion sort over shrinking gaps, so elements move far in few steps.',
    description:
      'Shell sort generalises insertion sort. It first sorts elements that are a large gap apart, then repeats with smaller gaps (here n/2, n/4, …, 1). Early passes move small values a long way towards the front, so the final gap-1 pass (a plain insertion sort) has little work left. It sorts in place and is not stable; its running time depends on the gap sequence.',
    input: 'An array of n comparable elements.',
    output: 'The array sorted in ascending order.',
    steps: ['gap = n / 2.', 'For each i from gap to n - 1: insert arr[i] into its gap-separated sub-list (shift larger elements gap positions right).', 'Halve the gap and repeat until the gap is 0.'],
    complexity: { best: 'O(n log n)', average: 'O(n^1.5)', worst: 'O(n²)', space: 'O(1)', note: 'With the simple n/2, n/4, … gaps the worst case is O(n²); better gap sequences improve it.' },
    example: { input: '[23, 12, 1, 8, 34, 54, 2, 3]', output: '[1, 2, 3, 8, 12, 23, 34, 54]', explanation: 'Gaps 4, 2, 1 progressively sort the array; the last pass is an insertion sort on nearly sorted data.' },
    keywords: ['shell sort', 'shellsort', 'diminishing increment sort', 'gap sort'],
    visual: 'sort',
    defaultInput: '23, 12, 1, 8, 34, 54, 2, 3',
    focus: 'shell_sort',
    source: 'python',
    expectedOutput: 'Sorted: 1 2 3 8 12 23 34 54 \n',
    python: `def shell_sort(arr):
    n = len(arr)
    gap = n // 2
    while gap > 0:
        for i in range(gap, n):
            temp = arr[i]
            j = i
            while j >= gap and arr[j - gap] > temp:
                arr[j] = arr[j - gap]
                j -= gap
            arr[j] = temp
        gap = gap // 2


arr = [23, 12, 1, 8, 34, 54, 2, 3]
shell_sort(arr)
print("Sorted:", end=" ")
for x in arr:
    print(x, end=" ")
print()
`,
  },
  {
    id: 'jump-search',
    name: 'Jump Search',
    category: 'Searching',
    difficulty: 'Medium',
    summary: 'Jump ahead in √n blocks through a sorted array, then scan one block.',
    description:
      'Jump search works on sorted arrays. It checks every √n-th element until it finds a block whose last element is at least the target, then performs a linear search inside that block. It needs O(√n) comparisons — between linear search O(n) and binary search O(log n) — and only moves forward, which helps when stepping backwards is expensive.',
    input: 'A sorted array of n elements and a target value.',
    output: 'The index of the target, or -1 if it is not present.',
    steps: ['step = ⌊√n⌋, prev = 0.', 'While arr[min(step, n) - 1] < target: prev = step, step += ⌊√n⌋; stop with -1 if prev ≥ n.', 'Linearly scan from prev while arr[prev] < target.', 'Return prev if arr[prev] == target, otherwise -1.'],
    complexity: { best: 'O(1)', average: 'O(√n)', worst: 'O(√n)', space: 'O(1)', note: 'The array must already be sorted.' },
    example: { input: '[0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144], target 55', output: '10', explanation: 'Jump size 3: check 1, 3, 13, 55 … the block ending at 55 contains the target at index 10.' },
    keywords: ['jump search', 'block search', 'square root search'],
    visual: 'search',
    defaultInput: '0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144 | 55',
    focus: 'jump_search',
    source: 'python',
    expectedOutput: 'Found 55 at index 10\nFound 7 at index -1\n',
    python: `def isqrt(n):
    r = 0
    while (r + 1) * (r + 1) <= n:
        r += 1
    return r


def jump_search(arr, target):
    n = len(arr)
    block = isqrt(n)
    step = block
    prev = 0
    while arr[min(step, n) - 1] < target:
        prev = step
        step += block
        if prev >= n:
            return -1
    while arr[prev] < target:
        prev += 1
        if prev == min(step, n):
            return -1
    if arr[prev] == target:
        return prev
    return -1


arr = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]
print("Found 55 at index", jump_search(arr, 55))
print("Found 7 at index", jump_search(arr, 7))
`,
  },
  {
    id: 'tree-traversal',
    name: 'Binary Tree Traversals',
    category: 'Data Structures',
    difficulty: 'Medium',
    summary: 'Visit every node in preorder, inorder and postorder — recursively.',
    description:
      'A traversal visits every node of a binary tree exactly once. Depth-first traversals differ only in when the node itself is visited: preorder (node, left, right) copies a tree, inorder (left, node, right) lists a binary search tree in sorted order, and postorder (left, right, node) deletes or evaluates a tree bottom-up. This version stores a complete binary tree in an array: the children of index i are 2i + 1 and 2i + 2.',
    input: 'A binary tree (here an array-backed complete binary tree).',
    output: 'The node values in preorder, inorder and postorder.',
    steps: ['If the index is outside the tree, return (empty subtree).', 'Preorder: visit node, traverse left, traverse right.', 'Inorder: traverse left, visit node, traverse right.', 'Postorder: traverse left, traverse right, visit node.'],
    complexity: { best: 'O(n)', average: 'O(n)', worst: 'O(n)', space: 'O(h)', note: 'h is the tree height — the depth of the recursion (call stack).' },
    example: { input: 'tree [1, 2, 3, 4, 5, 6, 7]', output: 'pre 1 2 4 5 3 6 7 · in 4 2 5 1 6 3 7 · post 4 5 2 6 7 3 1', explanation: '1 is the root, 2 and 3 its children, 4–7 the leaves.' },
    keywords: ['tree traversal', 'inorder', 'preorder', 'postorder', 'binary tree traversal', 'in order traversal', 'depth first traversal tree'],
    visual: 'traversal',
    defaultInput: '1, 2, 3, 4, 5, 6, 7 | inorder',
    focus: 'inorder',
    source: 'python',
    expectedOutput: 'Preorder: 1 2 4 5 3 6 7 \nInorder: 4 2 5 1 6 3 7 \nPostorder: 4 5 2 6 7 3 1 \n',
    python: `def preorder(tree, i):
    if i >= len(tree):
        return
    print(tree[i], end=" ")
    preorder(tree, 2 * i + 1)
    preorder(tree, 2 * i + 2)


def inorder(tree, i):
    if i >= len(tree):
        return
    inorder(tree, 2 * i + 1)
    print(tree[i], end=" ")
    inorder(tree, 2 * i + 2)


def postorder(tree, i):
    if i >= len(tree):
        return
    postorder(tree, 2 * i + 1)
    postorder(tree, 2 * i + 2)
    print(tree[i], end=" ")


tree = [1, 2, 3, 4, 5, 6, 7]
print("Preorder:", end=" ")
preorder(tree, 0)
print()
print("Inorder:", end=" ")
inorder(tree, 0)
print()
print("Postorder:", end=" ")
postorder(tree, 0)
print()
`,
  },
  {
    id: 'fast-power',
    name: 'Fast Exponentiation',
    category: 'Recursion',
    difficulty: 'Easy',
    summary: 'Compute xⁿ with O(log n) multiplications by halving the exponent.',
    description:
      'Exponentiation by squaring uses xⁿ = (x^(n/2))² for even n and xⁿ = x · x^(n-1) for odd n. Every two calls at most halve the exponent, so only O(log n) multiplications are needed instead of n - 1. The same idea powers modular exponentiation in cryptography and matrix powers for Fibonacci numbers.',
    input: 'A base x and a non-negative integer exponent n.',
    output: 'xⁿ',
    steps: ['Base case: if n == 0 return 1.', 'If n is even: half = power(x, n / 2); return half × half.', 'If n is odd: return x × power(x, n - 1).'],
    complexity: { best: 'O(log n)', average: 'O(log n)', worst: 'O(log n)', space: 'O(log n)', note: 'Recursion depth is O(log n); an iterative version needs O(1) space.' },
    example: { input: 'x = 2, n = 10', output: '1024', explanation: '2¹⁰ = (2⁵)², 2⁵ = 2 · 2⁴, 2⁴ = (2²)², 2² = (2¹)², 2¹ = 2 · 2⁰.' },
    keywords: ['fast power', 'exponentiation by squaring', 'binary exponentiation', 'power function', 'fast exponentiation', 'x to the power n'],
    visual: 'recursion',
    defaultInput: '2 | 10',
    focus: 'power',
    source: 'python',
    expectedOutput: '2^10 = 1024\n3^5 = 243\n',
    python: `def power(x, n):
    if n == 0:
        return 1
    if n % 2 == 0:
        half = power(x, n // 2)
        return half * half
    return x * power(x, n - 1)


print("2^10 =", power(2, 10))
print("3^5 =", power(3, 5))
`,
  },
];
