/** Built-in, offline learning content for the Learning Hub. */

export type Level = 'beginner' | 'advanced';
export interface Viva {
  q: string;
  a: string;
  level: Level;
}
export interface Mcq {
  q: string;
  options: [string, string, string, string];
  answer: number;
  explanation: string;
  level: Level;
}
export interface Practice {
  id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  statement: string;
  input: string;
  output: string;
  example: { input: string; output: string };
  constraints: string[];
  hints: string[];
  solution: string;
}
export interface Topic {
  id: string;
  name: string;
  icon: string;
  summary: string;
  points: string[];
  algorithms: string[];
  viva: Viva[];
  mcq: Mcq[];
  practice: Practice[];
}

export const TOPICS: Topic[] = [
  {
    id: 'searching',
    name: 'Searching',
    icon: 'search',
    summary: 'Finding an element in a collection — sequentially or by exploiting order.',
    points: [
      'Linear search works on any data and takes O(n) time.',
      'Binary search needs sorted data and takes O(log n) time.',
      'Binary search compares with the middle element and discards half of the range each step.',
      'Use low + (high - low) / 2 to avoid integer overflow when computing mid.',
      'Hashing gives O(1) average lookups at the cost of extra memory.',
    ],
    algorithms: ['linear-search', 'binary-search'],
    viva: [
      { q: 'What is the precondition for binary search?', a: 'The array (or search space) must be sorted, otherwise discarding half of the range could throw away the target.', level: 'beginner' },
      { q: 'What is the time complexity of linear search in the best and worst case?', a: 'Best case O(1) when the target is the first element; worst case O(n) when it is last or absent.', level: 'beginner' },
      { q: 'Why is mid often computed as low + (high - low) / 2?', a: 'low + high can overflow a fixed-size integer for large indexes; low + (high - low) / 2 gives the same value without overflow.', level: 'advanced' },
      { q: 'How would you find the first occurrence of a value in a sorted array with duplicates?', a: 'Run binary search, and when arr[mid] equals the target record mid but continue searching the left half (high = mid - 1). The last recorded index is the first occurrence.', level: 'advanced' },
      { q: 'When would you prefer linear search over binary search?', a: 'For small or unsorted arrays, linked lists without random access, or when the data is searched only once (sorting first would cost O(n log n)).', level: 'beginner' },
    ],
    mcq: [
      { q: 'What is the worst-case time complexity of binary search?', options: ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], answer: 1, explanation: 'Each comparison halves the search range, so at most about log₂ n comparisons are needed.', level: 'beginner' },
      { q: 'Binary search on [3, 8, 15, 21, 40] for 21 first compares with:', options: ['3', '8', '15', '40'], answer: 2, explanation: 'mid = (0 + 4) / 2 = 2, and arr[2] = 15.', level: 'beginner' },
      { q: 'Which data structure is NOT suitable for efficient binary search?', options: ['Sorted array', 'Sorted linked list', 'Sorted ArrayList', 'Sorted vector'], answer: 1, explanation: 'Linked lists do not support O(1) access to the middle element.', level: 'advanced' },
      { q: 'How many comparisons does linear search need in the worst case for 100 elements?', options: ['7', '50', '100', '10'], answer: 2, explanation: 'The target may be last or absent, so all 100 elements are compared.', level: 'beginner' },
    ],
    practice: [
      {
        id: 'search-first-last',
        title: 'First and last position',
        difficulty: 'Medium',
        statement: 'Given a sorted array and a target, print the index of its first and last occurrence (or -1 -1 if it is absent).',
        input: 'n, then n sorted integers, then the target.',
        output: 'Two indexes separated by a space.',
        example: { input: '6\n5 7 7 8 8 10\n8', output: '3 4' },
        constraints: ['1 ≤ n ≤ 10⁵', 'Must run in O(log n)'],
        hints: ['Run binary search twice.', 'For the first occurrence keep going left after a match; for the last keep going right.'],
        solution: `def bound(arr, target, first):
    low = 0
    high = len(arr) - 1
    ans = -1
    while low <= high:
        mid = (low + high) // 2
        if arr[mid] == target:
            ans = mid
            if first:
                high = mid - 1
            else:
                low = mid + 1
        elif arr[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return ans


n = int(input())
arr = list(map(int, input().split()))
target = int(input())
print(bound(arr, target, True), bound(arr, target, False))
`,
      },
      {
        id: 'search-count',
        title: 'Count occurrences',
        difficulty: 'Easy',
        statement: 'Read n integers and a value x, and print how many times x appears.',
        input: 'n, then n integers, then x.',
        output: 'The count.',
        example: { input: '5\n1 2 2 3 2\n2', output: '3' },
        constraints: ['1 ≤ n ≤ 1000'],
        hints: ['A single linear scan with a counter is enough.'],
        solution: `n = int(input())
arr = list(map(int, input().split()))
x = int(input())
count = 0
for v in arr:
    if v == x:
        count += 1
print(count)
`,
      },
    ],
  },
  {
    id: 'sorting',
    name: 'Sorting',
    icon: 'arrow-up-down',
    summary: 'Arranging elements in order — the gateway to efficient searching and grouping.',
    points: [
      'Simple sorts (bubble, selection, insertion) are O(n²) but in-place and easy to write.',
      'Merge sort and heap sort guarantee O(n log n); quick sort is O(n log n) on average.',
      'A sort is stable if equal elements keep their relative order (merge, insertion, bubble).',
      'No comparison sort can beat Ω(n log n) in the worst case.',
      'Insertion sort is excellent for small or nearly sorted inputs.',
    ],
    algorithms: ['bubble-sort', 'selection-sort', 'insertion-sort', 'merge-sort', 'quick-sort', 'heap-sort'],
    viva: [
      { q: 'What does it mean for a sorting algorithm to be stable?', a: 'Elements with equal keys appear in the same relative order in the output as in the input. Merge sort and insertion sort are stable; quick sort and heap sort are not.', level: 'beginner' },
      { q: 'Why is quick sort O(n²) in the worst case?', a: 'If the pivot is always the smallest or largest element (e.g. last-element pivot on sorted data), one side of each partition is empty and the recursion depth becomes n.', level: 'advanced' },
      { q: 'Which simple sort makes the fewest swaps?', a: 'Selection sort — at most n - 1 swaps, because each pass places exactly one element.', level: 'beginner' },
      { q: 'What is the space complexity of merge sort and why?', a: 'O(n) — merging needs an auxiliary array to hold the merged elements.', level: 'beginner' },
      { q: 'How can quick sort avoid its worst case?', a: 'Choose the pivot randomly or as the median of three elements, and recurse into the smaller side first to keep stack depth O(log n).', level: 'advanced' },
    ],
    mcq: [
      { q: 'Best-case complexity of bubble sort with an early-exit flag?', options: ['O(n²)', 'O(n log n)', 'O(n)', 'O(1)'], answer: 2, explanation: 'On sorted input the first pass makes no swaps and the algorithm stops after n - 1 comparisons.', level: 'beginner' },
      { q: 'Which algorithm is NOT stable?', options: ['Merge sort', 'Insertion sort', 'Bubble sort', 'Heap sort'], answer: 3, explanation: 'Heap sort can move equal elements past each other when swapping with the root.', level: 'advanced' },
      { q: 'Which sorting algorithm uses a pivot?', options: ['Merge sort', 'Quick sort', 'Heap sort', 'Insertion sort'], answer: 1, explanation: 'Quick sort partitions the array around a pivot element.', level: 'beginner' },
      { q: 'Merge sort follows which paradigm?', options: ['Greedy', 'Dynamic programming', 'Divide and conquer', 'Backtracking'], answer: 2, explanation: 'It divides the array, conquers the halves recursively and combines them by merging.', level: 'beginner' },
    ],
    practice: [
      {
        id: 'sort-k-largest',
        title: 'Third largest element',
        difficulty: 'Easy',
        statement: 'Print the third largest distinct value of an array, or -1 if there are fewer than three distinct values.',
        input: 'n, then n integers.',
        output: 'The third largest distinct value.',
        example: { input: '6\n4 9 2 9 7 5', output: '5' },
        constraints: ['1 ≤ n ≤ 1000'],
        hints: ['Sort in descending order and skip duplicates.', 'Or keep the three largest values in one pass.'],
        solution: `n = int(input())
arr = sorted(set(map(int, input().split())), reverse=True)
print(arr[2] if len(arr) >= 3 else -1)
`,
      },
      {
        id: 'sort-012',
        title: 'Sort 0s, 1s and 2s',
        difficulty: 'Medium',
        statement: 'An array contains only 0, 1 and 2. Sort it in one pass without a sorting library (Dutch national flag problem).',
        input: 'n, then n values from {0, 1, 2}.',
        output: 'The sorted array.',
        example: { input: '6\n2 0 2 1 1 0', output: '0 0 1 1 2 2' },
        constraints: ['O(n) time, O(1) extra space'],
        hints: ['Keep three pointers: low, mid and high.', '0 → swap to low, 2 → swap to high, 1 → move on.'],
        solution: `n = int(input())
a = list(map(int, input().split()))
low = 0
mid = 0
high = n - 1
while mid <= high:
    if a[mid] == 0:
        a[low], a[mid] = a[mid], a[low]
        low += 1
        mid += 1
    elif a[mid] == 1:
        mid += 1
    else:
        a[mid], a[high] = a[high], a[mid]
        high -= 1
print(*a)
`,
      },
    ],
  },
  {
    id: 'arrays',
    name: 'Arrays',
    icon: 'brackets',
    summary: 'Contiguous, index-addressable storage — the foundation of most algorithms.',
    points: [
      'Access by index is O(1); inserting or deleting in the middle is O(n) because elements shift.',
      'Indexes start at 0; the last valid index is n - 1.',
      'Two-pointer and sliding-window techniques solve many array problems in O(n).',
      'Prefix sums answer range-sum queries in O(1) after O(n) preprocessing.',
      'Out-of-bounds access is undefined behaviour in C/C++ and an exception in Java/Python.',
    ],
    algorithms: ['kadane', 'two-sum'],
    viva: [
      { q: 'Why is array access O(1)?', a: 'Elements are stored contiguously with equal size, so the address of element i is base + i × size, computed in constant time.', level: 'beginner' },
      { q: 'What is the difference between an array and a dynamic array (vector/ArrayList)?', a: 'A static array has a fixed size. A dynamic array grows by allocating a larger block (usually doubling) and copying, giving amortised O(1) append.', level: 'beginner' },
      { q: 'Explain the sliding window technique.', a: 'Maintain a window [left, right] and update an aggregate as right advances, moving left when the window becomes invalid; each index enters and leaves once, so it is O(n).', level: 'advanced' },
      { q: 'What is a prefix sum array?', a: 'prefix[i] = a[0] + … + a[i-1]; the sum of a[l..r] is prefix[r+1] - prefix[l].', level: 'advanced' },
    ],
    mcq: [
      { q: 'What is the index of the last element in an array of size n?', options: ['n', 'n - 1', 'n + 1', '0'], answer: 1, explanation: 'Indexes run from 0 to n - 1.', level: 'beginner' },
      { q: 'Inserting at the beginning of an array of n elements costs:', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], answer: 2, explanation: 'All n elements must shift one position to the right.', level: 'beginner' },
      { q: "Kadane's algorithm solves:", options: ['Longest increasing subsequence', 'Maximum subarray sum', 'Two sum', 'Matrix multiplication'], answer: 1, explanation: 'It finds the maximum-sum contiguous subarray in O(n).', level: 'advanced' },
      { q: 'Amortised cost of appending to a dynamic array that doubles its capacity:', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], answer: 0, explanation: 'Occasional O(n) copies are spread over many O(1) appends.', level: 'advanced' },
    ],
    practice: [
      {
        id: 'array-rotate',
        title: 'Rotate an array',
        difficulty: 'Easy',
        statement: 'Rotate an array to the right by k positions.',
        input: 'n and k, then n integers.',
        output: 'The rotated array.',
        example: { input: '5 2\n1 2 3 4 5', output: '4 5 1 2 3' },
        constraints: ['1 ≤ n ≤ 10⁵', '0 ≤ k ≤ 10⁹'],
        hints: ['Rotating by k equals rotating by k mod n.', 'Reverse the whole array, then reverse the first k and the remaining n - k elements.'],
        solution: `n, k = map(int, input().split())
a = list(map(int, input().split()))
k %= n
print(*(a[n - k:] + a[:n - k]))
`,
      },
      {
        id: 'array-missing',
        title: 'Missing number',
        difficulty: 'Easy',
        statement: 'An array has n - 1 distinct numbers from 1..n. Find the missing one.',
        input: 'n, then n - 1 integers.',
        output: 'The missing number.',
        example: { input: '5\n1 2 4 5', output: '3' },
        constraints: ['2 ≤ n ≤ 10⁶'],
        hints: ['The sum 1 + … + n = n(n + 1) / 2.'],
        solution: `n = int(input())
a = list(map(int, input().split()))
print(n * (n + 1) // 2 - sum(a))
`,
      },
    ],
  },
  {
    id: 'strings',
    name: 'Strings',
    icon: 'type',
    summary: 'Sequences of characters: comparison, reversal, counting and pattern matching.',
    points: [
      'In C a string is a char array terminated by \\0; strlen is O(n).',
      'Java and Python strings are immutable — concatenation in a loop creates new objects (use StringBuilder / join).',
      'Character arithmetic: c - \'a\' gives the alphabet position of a lowercase letter.',
      'Two pointers from both ends check palindromes in O(n).',
      'Frequency arrays of size 26 (or 256) count characters in O(n).',
    ],
    algorithms: [],
    viva: [
      { q: 'How do you compare two strings in Java correctly?', a: 'Use a.equals(b) (or equalsIgnoreCase). == compares object references, not contents.', level: 'beginner' },
      { q: 'How is a string stored in C?', a: 'As an array of char ending with the null character \\0, which marks the end of the string.', level: 'beginner' },
      { q: 'Why is repeated string concatenation in a loop slow in Java?', a: 'Strings are immutable, so each + creates a new String and copies the old contents — O(n²) overall. StringBuilder appends in amortised O(1).', level: 'advanced' },
      { q: 'How do you check if two strings are anagrams?', a: 'Compare their character counts (frequency array of 26) or compare the sorted strings.', level: 'beginner' },
    ],
    mcq: [
      { q: 'Which function returns the length of a C string?', options: ['size()', 'length()', 'strlen()', 'len()'], answer: 2, explanation: 'strlen from <string.h> counts characters up to the terminating \\0.', level: 'beginner' },
      { q: "'c' - 'a' evaluates to:", options: ['1', '2', '3', "'b'"], answer: 1, explanation: 'Characters are numbers; c is two positions after a.', level: 'beginner' },
      { q: 'Checking a palindrome with two pointers takes:', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], answer: 2, explanation: 'Each character is compared at most once.', level: 'beginner' },
      { q: 'Which is mutable in Java?', options: ['String', 'StringBuilder', 'Integer', 'Character'], answer: 1, explanation: 'StringBuilder modifies its internal buffer in place.', level: 'advanced' },
    ],
    practice: [
      {
        id: 'str-palindrome',
        title: 'Valid palindrome',
        difficulty: 'Easy',
        statement: 'Check whether a word reads the same forwards and backwards.',
        input: 'A single word.',
        output: 'YES or NO.',
        example: { input: 'racecar', output: 'YES' },
        constraints: ['1 ≤ length ≤ 10⁵'],
        hints: ['Compare s[i] with s[n - 1 - i].'],
        solution: `s = input().strip()
print("YES" if s == s[::-1] else "NO")
`,
      },
      {
        id: 'str-vowels',
        title: 'Count vowels',
        difficulty: 'Easy',
        statement: 'Count the vowels (a, e, i, o, u — case-insensitive) in a line of text.',
        input: 'A line of text.',
        output: 'The number of vowels.',
        example: { input: 'Hello World', output: '3' },
        constraints: ['1 ≤ length ≤ 10⁵'],
        hints: ['Convert to lowercase and test membership in "aeiou".'],
        solution: `s = input().lower()
print(sum(1 for c in s if c in "aeiou"))
`,
      },
    ],
  },
  {
    id: 'linked-lists',
    name: 'Linked Lists',
    icon: 'link',
    summary: 'Nodes joined by pointers — cheap insertions, sequential access.',
    points: [
      'Each node stores data and a pointer/reference to the next node.',
      'Insertion/deletion at a known node is O(1); finding a position is O(n).',
      'Doubly linked lists also keep a prev pointer for backward traversal.',
      'Floyd’s tortoise-and-hare detects cycles in O(n) time and O(1) space.',
      'Always handle the empty list and the head node as special cases.',
    ],
    algorithms: ['linked-list'],
    viva: [
      { q: 'What are the advantages of a linked list over an array?', a: 'Dynamic size and O(1) insertion/deletion when you already have a pointer to the position — no shifting of elements.', level: 'beginner' },
      { q: 'How do you reverse a singly linked list?', a: 'Walk the list with prev = NULL and cur = head; at each node save next, set cur.next = prev, then advance prev and cur. Finally head = prev.', level: 'advanced' },
      { q: 'How do you detect a cycle in a linked list?', a: 'Floyd’s algorithm: move slow by one and fast by two nodes; if they ever meet there is a cycle, if fast reaches NULL there is none.', level: 'advanced' },
      { q: 'What is a NULL pointer used for in a linked list?', a: 'It marks the end of the list (the last node’s next) and an empty list (head == NULL).', level: 'beginner' },
    ],
    mcq: [
      { q: 'Accessing the k-th element of a singly linked list costs:', options: ['O(1)', 'O(log n)', 'O(k)', 'O(n²)'], answer: 2, explanation: 'You must follow k next pointers from the head.', level: 'beginner' },
      { q: 'Which operation is O(1) in a singly linked list with only a head pointer?', options: ['Insert at tail', 'Insert at head', 'Delete last node', 'Search'], answer: 1, explanation: 'Creating a node that points to the old head takes constant time.', level: 'beginner' },
      { q: 'Floyd’s cycle detection uses:', options: ['A hash set', 'Two pointers moving at different speeds', 'Recursion', 'Sorting'], answer: 1, explanation: 'Slow and fast pointers meet inside a cycle.', level: 'advanced' },
      { q: 'Extra memory per node in a doubly linked list compared to singly:', options: ['None', 'One pointer', 'Two pointers', 'An array'], answer: 1, explanation: 'Each node additionally stores a prev pointer.', level: 'beginner' },
    ],
    practice: [
      {
        id: 'll-middle',
        title: 'Middle of a linked list',
        difficulty: 'Easy',
        statement: 'Given the values of a linked list, print the value of the middle node (the second middle if the length is even).',
        input: 'n, then n values in list order.',
        output: 'The middle value.',
        example: { input: '6\n1 2 3 4 5 6', output: '4' },
        constraints: ['1 ≤ n ≤ 10⁵'],
        hints: ['Slow pointer moves one step, fast pointer two steps; when fast reaches the end, slow is in the middle.'],
        solution: `n = int(input())
values = list(map(int, input().split()))
slow = 0
fast = 0
while fast < n and fast + 1 < n:
    slow += 1
    fast += 2
print(values[slow])
`,
      },
      {
        id: 'll-reverse',
        title: 'Reverse a linked list',
        difficulty: 'Medium',
        statement: 'Build a linked list from the input values, reverse it in place and print it.',
        input: 'n, then n values.',
        output: 'The reversed list.',
        example: { input: '4\n1 2 3 4', output: '4 3 2 1' },
        constraints: ['0 ≤ n ≤ 10⁵', 'O(1) extra space'],
        hints: ['Keep prev, cur and next pointers.'],
        solution: `class Node:
    def __init__(self, v):
        self.v = v
        self.next = None


n = int(input())
head = None
for v in reversed(list(map(int, input().split()))):
    node = Node(v)
    node.next = head
    head = node
prev = None
cur = head
while cur:
    nxt = cur.next
    cur.next = prev
    prev = cur
    cur = nxt
out = []
while prev:
    out.append(prev.v)
    prev = prev.next
print(*out)
`,
      },
    ],
  },
  {
    id: 'stacks',
    name: 'Stacks',
    icon: 'layers',
    summary: 'Last-in, first-out: function calls, undo, parsing and backtracking.',
    points: [
      'push, pop and peek are O(1).',
      'The call stack stores local variables and return addresses of active function calls.',
      'Stacks check balanced brackets and evaluate postfix expressions.',
      'A monotonic stack finds the next greater element in O(n).',
      'Overflow = push on a full stack; underflow = pop on an empty stack.',
    ],
    algorithms: ['stack'],
    viva: [
      { q: 'Give three real-world applications of a stack.', a: 'Function call management (call stack), undo/redo in editors, browser back button, expression evaluation and bracket matching.', level: 'beginner' },
      { q: 'How do you check balanced parentheses with a stack?', a: 'Push every opening bracket; on a closing bracket the stack must be non-empty and its top must be the matching opener, which is popped. At the end the stack must be empty.', level: 'beginner' },
      { q: 'How can you implement a queue using two stacks?', a: 'Push into stack A; to dequeue, if stack B is empty move all elements from A to B (reversing order), then pop from B. Each element moves at most once, so operations are amortised O(1).', level: 'advanced' },
      { q: 'What is stack overflow in recursion?', a: 'When recursion is too deep, the call stack runs out of memory and the program crashes — usually due to a missing base case.', level: 'beginner' },
    ],
    mcq: [
      { q: 'Push 1, push 2, push 3, pop, push 4. What is on top?', options: ['1', '2', '3', '4'], answer: 3, explanation: 'After popping 3 the stack is [1, 2]; pushing 4 makes 4 the top.', level: 'beginner' },
      { q: 'Postfix 2 3 4 * + evaluates to:', options: ['20', '14', '24', '9'], answer: 1, explanation: '3 * 4 = 12, then 2 + 12 = 14.', level: 'advanced' },
      { q: 'Which traversal naturally uses a stack?', options: ['BFS', 'DFS', 'Level order', 'Dijkstra'], answer: 1, explanation: 'DFS explores depth-first, which matches LIFO behaviour.', level: 'beginner' },
      { q: 'Time complexity of pop on an array-based stack:', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], answer: 0, explanation: 'Only the top index changes.', level: 'beginner' },
    ],
    practice: [
      {
        id: 'stack-brackets',
        title: 'Balanced brackets',
        difficulty: 'Easy',
        statement: 'Determine whether a string of brackets ()[]{} is balanced.',
        input: 'A string of brackets.',
        output: 'YES or NO.',
        example: { input: '{[()]}', output: 'YES' },
        constraints: ['1 ≤ length ≤ 10⁵'],
        hints: ['Push opening brackets; match and pop on closing brackets.'],
        solution: `s = input().strip()
pairs = {")": "(", "]": "[", "}": "{"}
stack = []
ok = True
for c in s:
    if c in "([{":
        stack.append(c)
    elif not stack or stack.pop() != pairs[c]:
        ok = False
        break
print("YES" if ok and not stack else "NO")
`,
      },
      {
        id: 'stack-next-greater',
        title: 'Next greater element',
        difficulty: 'Medium',
        statement: 'For each element print the first greater element to its right, or -1.',
        input: 'n, then n integers.',
        output: 'n integers.',
        example: { input: '4\n4 5 2 25', output: '5 25 25 -1' },
        constraints: ['1 ≤ n ≤ 10⁵', 'O(n) expected'],
        hints: ['Scan from the right and keep a stack of candidates in decreasing order.'],
        solution: `n = int(input())
a = list(map(int, input().split()))
res = [-1] * n
stack = []
for i in range(n - 1, -1, -1):
    while stack and stack[-1] <= a[i]:
        stack.pop()
    if stack:
        res[i] = stack[-1]
    stack.append(a[i])
print(*res)
`,
      },
    ],
  },
  {
    id: 'queues',
    name: 'Queues',
    icon: 'list-ordered',
    summary: 'First-in, first-out: scheduling, buffering and breadth-first search.',
    points: [
      'enqueue at the rear and dequeue at the front, both O(1).',
      'A circular queue reuses freed slots by wrapping indexes with modulo.',
      'A deque supports insertion and deletion at both ends.',
      'A priority queue (heap) always removes the highest-priority element in O(log n).',
      'BFS uses a queue to visit vertices in order of distance.',
    ],
    algorithms: ['queue', 'bfs'],
    viva: [
      { q: 'Why use a circular queue instead of a simple array queue?', a: 'In a simple array queue, dequeued slots at the front are wasted. A circular queue wraps rear and front around with modulo so the whole array is reused.', level: 'beginner' },
      { q: 'How do you detect a full circular queue?', a: 'Keep a size counter (size == capacity), or leave one slot empty and test (rear + 1) % capacity == front.', level: 'advanced' },
      { q: 'What is the difference between a queue and a priority queue?', a: 'A queue serves elements in arrival order; a priority queue serves the element with the highest priority first, typically implemented as a binary heap.', level: 'beginner' },
      { q: 'Where are queues used in operating systems?', a: 'CPU scheduling (round robin ready queue), I/O request buffers, print spooling and message passing.', level: 'beginner' },
    ],
    mcq: [
      { q: 'Enqueue 1, 2, 3 then dequeue. Which value is removed?', options: ['1', '2', '3', 'None'], answer: 0, explanation: 'FIFO: the first element in is the first out.', level: 'beginner' },
      { q: 'In a circular queue of capacity 5, rear = 4. After one enqueue rear becomes:', options: ['5', '0', '4', '1'], answer: 1, explanation: '(4 + 1) % 5 = 0.', level: 'advanced' },
      { q: 'Which structure does BFS use?', options: ['Stack', 'Queue', 'Heap', 'Tree'], answer: 1, explanation: 'BFS processes vertices in FIFO order of discovery.', level: 'beginner' },
      { q: 'Removing the minimum from a binary min-heap costs:', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], answer: 1, explanation: 'The last element moves to the root and sifts down one level at a time.', level: 'advanced' },
    ],
    practice: [
      {
        id: 'queue-simulate',
        title: 'Ticket counter simulation',
        difficulty: 'Easy',
        statement: 'Process operations "E x" (enqueue person x) and "D" (serve the front person). Print who is served for each D, or EMPTY.',
        input: 'q, then q operations.',
        output: 'One line per D.',
        example: { input: '4\nE 5\nE 9\nD\nD', output: '5\n9' },
        constraints: ['1 ≤ q ≤ 10⁵'],
        hints: ['Use collections.deque in Python, ArrayDeque in Java, std::queue in C++.'],
        solution: `from collections import deque

q = deque()
for _ in range(int(input())):
    parts = input().split()
    if parts[0] == "E":
        q.append(parts[1])
    else:
        print(q.popleft() if q else "EMPTY")
`,
      },
      {
        id: 'queue-window-max',
        title: 'Sliding window maximum',
        difficulty: 'Hard',
        statement: 'Print the maximum of every window of size k.',
        input: 'n and k, then n integers.',
        output: 'n - k + 1 integers.',
        example: { input: '8 3\n1 3 -1 -3 5 3 6 7', output: '3 3 5 5 6 7' },
        constraints: ['1 ≤ k ≤ n ≤ 10⁵'],
        hints: ['Keep a deque of indexes whose values are decreasing.', 'Drop indexes that left the window from the front.'],
        solution: `from collections import deque

n, k = map(int, input().split())
a = list(map(int, input().split()))
dq = deque()
out = []
for i in range(n):
    while dq and a[dq[-1]] <= a[i]:
        dq.pop()
    dq.append(i)
    if dq[0] <= i - k:
        dq.popleft()
    if i >= k - 1:
        out.append(a[dq[0]])
print(*out)
`,
      },
    ],
  },
  {
    id: 'trees',
    name: 'Trees',
    icon: 'git-fork',
    summary: 'Hierarchical structures: binary trees, BSTs, heaps and traversals.',
    points: [
      'A binary tree node has at most two children: left and right.',
      'Traversals: preorder (root, left, right), inorder (left, root, right), postorder (left, right, root), level order (BFS).',
      'Inorder traversal of a BST yields sorted keys.',
      'Height of a balanced tree with n nodes is O(log n); a degenerate tree has height O(n).',
      'Self-balancing trees (AVL, red-black) keep operations O(log n).',
    ],
    algorithms: ['bst', 'heap-sort'],
    viva: [
      { q: 'What is the BST property?', a: 'For every node, all keys in its left subtree are smaller and all keys in its right subtree are larger.', level: 'beginner' },
      { q: 'Which traversal of a BST gives sorted output?', a: 'Inorder traversal (left subtree, node, right subtree).', level: 'beginner' },
      { q: 'How do you delete a node with two children from a BST?', a: 'Replace its key with the inorder successor (smallest key in the right subtree) or predecessor, then delete that successor node, which has at most one child.', level: 'advanced' },
      { q: 'What is the difference between a complete and a full binary tree?', a: 'Full: every node has 0 or 2 children. Complete: all levels are filled except possibly the last, which is filled from left to right (as in heaps).', level: 'advanced' },
      { q: 'What is the height of a tree?', a: 'The number of edges on the longest path from the root to a leaf (some books count nodes instead).', level: 'beginner' },
    ],
    mcq: [
      { q: 'Preorder of a tree with root 1, left child 2, right child 3:', options: ['2 1 3', '1 2 3', '2 3 1', '3 2 1'], answer: 1, explanation: 'Preorder visits root first, then left, then right.', level: 'beginner' },
      { q: 'Worst-case search time in an unbalanced BST:', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], answer: 2, explanation: 'Sorted insertions produce a chain of height n.', level: 'beginner' },
      { q: 'Maximum number of nodes in a binary tree of height h (root at height 0):', options: ['2h', '2^h', '2^(h+1) - 1', 'h²'], answer: 2, explanation: 'Level i has at most 2^i nodes; summing levels 0..h gives 2^(h+1) - 1.', level: 'advanced' },
      { q: 'A max-heap stores its maximum at:', options: ['The last leaf', 'The root', 'The leftmost leaf', 'Any node'], answer: 1, explanation: 'The heap property makes every parent ≥ its children.', level: 'beginner' },
    ],
    practice: [
      {
        id: 'tree-height',
        title: 'Height of a BST',
        difficulty: 'Easy',
        statement: 'Insert the given keys into an empty BST in order and print its height (number of nodes on the longest root-to-leaf path).',
        input: 'n, then n keys.',
        output: 'The height.',
        example: { input: '5\n50 30 70 20 10', output: '4' },
        constraints: ['1 ≤ n ≤ 1000'],
        hints: ['height(node) = 1 + max(height(left), height(right)); empty tree has height 0.'],
        solution: `class Node:
    def __init__(self, k):
        self.k = k
        self.l = None
        self.r = None


def insert(root, k):
    if root is None:
        return Node(k)
    if k < root.k:
        root.l = insert(root.l, k)
    else:
        root.r = insert(root.r, k)
    return root


def height(root):
    if root is None:
        return 0
    return 1 + max(height(root.l), height(root.r))


n = int(input())
root = None
for k in map(int, input().split()):
    root = insert(root, k)
print(height(root))
`,
      },
      {
        id: 'tree-levels',
        title: 'Level order traversal',
        difficulty: 'Medium',
        statement: 'Insert keys into a BST and print them level by level (one level per line).',
        input: 'n, then n keys.',
        output: 'Each level on its own line.',
        example: { input: '5\n50 30 70 20 40', output: '50\n30 70\n20 40' },
        constraints: ['1 ≤ n ≤ 1000'],
        hints: ['Use a queue; process the nodes of one level at a time using the queue size.'],
        solution: `from collections import deque


class Node:
    def __init__(self, k):
        self.k = k
        self.l = None
        self.r = None


def insert(root, k):
    if root is None:
        return Node(k)
    if k < root.k:
        root.l = insert(root.l, k)
    else:
        root.r = insert(root.r, k)
    return root


n = int(input())
root = None
for k in map(int, input().split()):
    root = insert(root, k)
q = deque([root])
while q:
    level = []
    for _ in range(len(q)):
        node = q.popleft()
        level.append(node.k)
        if node.l:
            q.append(node.l)
        if node.r:
            q.append(node.r)
    print(*level)
`,
      },
    ],
  },
  {
    id: 'graphs',
    name: 'Graphs',
    icon: 'share-2',
    summary: 'Vertices and edges: traversal, shortest paths and connectivity.',
    points: [
      'Represent graphs with an adjacency matrix (O(V²) space) or adjacency lists (O(V + E)).',
      'BFS finds shortest paths in unweighted graphs; DFS is used for cycles, components and topological order.',
      "Dijkstra's algorithm finds shortest paths with non-negative weights.",
      'Bellman–Ford handles negative weights and detects negative cycles.',
      'A tree is a connected acyclic graph with V - 1 edges.',
    ],
    algorithms: ['bfs', 'dfs', 'dijkstra'],
    viva: [
      { q: 'Compare adjacency matrix and adjacency list representations.', a: 'Matrix: O(V²) space, O(1) edge lookup, good for dense graphs. List: O(V + E) space, iterate neighbours efficiently, good for sparse graphs.', level: 'beginner' },
      { q: "Why does Dijkstra's algorithm fail with negative edge weights?", a: 'It finalises the closest vertex assuming no later path can be shorter; a negative edge discovered later could make a finalised distance smaller.', level: 'advanced' },
      { q: 'How do you detect a cycle in an undirected graph with DFS?', a: 'During DFS, if you reach an already visited vertex that is not the parent of the current vertex, there is a cycle.', level: 'advanced' },
      { q: 'What is the time complexity of BFS with adjacency lists?', a: 'O(V + E): every vertex is enqueued once and every edge is examined once (twice for undirected graphs).', level: 'beginner' },
    ],
    mcq: [
      { q: 'Which algorithm finds the shortest path in an unweighted graph?', options: ['DFS', 'BFS', 'Prim', 'Kruskal'], answer: 1, explanation: 'BFS visits vertices in increasing number of edges from the source.', level: 'beginner' },
      { q: 'Space of an adjacency matrix for V vertices:', options: ['O(V)', 'O(E)', 'O(V + E)', 'O(V²)'], answer: 3, explanation: 'It stores a V × V table.', level: 'beginner' },
      { q: 'Topological sorting applies to:', options: ['Any graph', 'Undirected graphs', 'Directed acyclic graphs', 'Complete graphs'], answer: 2, explanation: 'A cycle would make a consistent order impossible.', level: 'advanced' },
      { q: "Dijkstra with a binary heap runs in:", options: ['O(V²)', 'O((V + E) log V)', 'O(VE)', 'O(E)'], answer: 1, explanation: 'Each edge relaxation may push into the heap at O(log V) cost.', level: 'advanced' },
    ],
    practice: [
      {
        id: 'graph-components',
        title: 'Connected components',
        difficulty: 'Medium',
        statement: 'Count the connected components of an undirected graph.',
        input: 'V and E, then E lines "u v" (0-indexed).',
        output: 'Number of components.',
        example: { input: '5 3\n0 1\n1 2\n3 4', output: '2' },
        constraints: ['1 ≤ V ≤ 10⁵', '0 ≤ E ≤ 2·10⁵'],
        hints: ['Run DFS/BFS from every unvisited vertex and count how many times you start.'],
        solution: `V, E = map(int, input().split())
adj = [[] for _ in range(V)]
for _ in range(E):
    u, v = map(int, input().split())
    adj[u].append(v)
    adj[v].append(u)
seen = [False] * V
count = 0
for s in range(V):
    if not seen[s]:
        count += 1
        stack = [s]
        seen[s] = True
        while stack:
            u = stack.pop()
            for v in adj[u]:
                if not seen[v]:
                    seen[v] = True
                    stack.append(v)
print(count)
`,
      },
      {
        id: 'graph-shortest-grid',
        title: 'Shortest path in a grid',
        difficulty: 'Medium',
        statement: 'Find the minimum number of steps from the top-left to the bottom-right of a grid moving up/down/left/right through "." cells ("#" is a wall). Print -1 if unreachable.',
        input: 'R and C, then R rows.',
        output: 'Minimum steps.',
        example: { input: '3 3\n..#\n.#.\n...', output: '4' },
        constraints: ['1 ≤ R, C ≤ 1000'],
        hints: ['BFS from the start; the first time you reach the target is the shortest.'],
        solution: `from collections import deque

R, C = map(int, input().split())
g = [input() for _ in range(R)]
dist = [[-1] * C for _ in range(R)]
dist[0][0] = 0
q = deque([(0, 0)])
while q:
    r, c = q.popleft()
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < R and 0 <= nc < C and g[nr][nc] == "." and dist[nr][nc] == -1:
            dist[nr][nc] = dist[r][c] + 1
            q.append((nr, nc))
print(dist[R - 1][C - 1])
`,
      },
    ],
  },
  {
    id: 'recursion',
    name: 'Recursion',
    icon: 'repeat',
    summary: 'Functions that call themselves on smaller sub-problems.',
    points: [
      'Every recursive function needs a base case that stops the recursion.',
      'Each call gets its own stack frame with its own local variables.',
      'Recursion depth determines stack memory usage.',
      'Divide and conquer (merge sort, quick sort) is naturally recursive.',
      'Tail recursion can be turned into a loop.',
    ],
    algorithms: ['factorial', 'fibonacci', 'recursion'],
    viva: [
      { q: 'What happens if a recursive function has no base case?', a: 'It calls itself forever until the call stack overflows and the program crashes (StackOverflowError / segmentation fault / RecursionError).', level: 'beginner' },
      { q: 'What is the difference between recursion and iteration?', a: 'Recursion repeats work through function calls and uses the call stack; iteration repeats with loops and constant stack space. Any recursion can be rewritten iteratively, sometimes with an explicit stack.', level: 'beginner' },
      { q: 'What is tail recursion?', a: 'A recursive call that is the very last operation of the function. Compilers can optimise it into a loop (tail-call optimisation), avoiding stack growth.', level: 'advanced' },
      { q: 'Why is naive recursive Fibonacci slow?', a: 'fib(n) calls fib(n-1) and fib(n-2), which recompute the same sub-problems repeatedly — about φⁿ calls. Memoisation reduces it to O(n).', level: 'advanced' },
    ],
    mcq: [
      { q: 'How many moves does Tower of Hanoi need for 4 disks?', options: ['8', '15', '16', '31'], answer: 1, explanation: '2⁴ - 1 = 15.', level: 'beginner' },
      { q: 'Stack space used by recursive factorial(n):', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], answer: 2, explanation: 'There are n nested calls active at the deepest point.', level: 'beginner' },
      { q: 'factorial(0) should return:', options: ['0', '1', 'undefined', '-1'], answer: 1, explanation: '0! is defined as 1 (the empty product).', level: 'beginner' },
      { q: 'Recurrence of merge sort:', options: ['T(n) = T(n-1) + O(1)', 'T(n) = 2T(n/2) + O(n)', 'T(n) = T(n/2) + O(1)', 'T(n) = 2T(n-1) + O(1)'], answer: 1, explanation: 'Two halves plus a linear merge, which solves to O(n log n).', level: 'advanced' },
    ],
    practice: [
      {
        id: 'rec-power',
        title: 'Fast power',
        difficulty: 'Medium',
        statement: 'Compute a^b mod 1,000,000,007 using recursion in O(log b).',
        input: 'a and b.',
        output: 'a^b mod 1e9+7.',
        example: { input: '2 10', output: '1024' },
        constraints: ['0 ≤ a, b ≤ 10¹⁸'],
        hints: ['a^b = (a^(b/2))² when b is even, and a · a^(b-1) when b is odd.'],
        solution: `MOD = 1000000007


def power(a, b):
    if b == 0:
        return 1
    half = power(a, b // 2)
    result = half * half % MOD
    if b % 2 == 1:
        result = result * a % MOD
    return result


a, b = map(int, input().split())
print(power(a % MOD, b))
`,
      },
      {
        id: 'rec-sum-digits',
        title: 'Sum of digits',
        difficulty: 'Easy',
        statement: 'Compute the sum of the digits of n recursively.',
        input: 'A non-negative integer n.',
        output: 'The digit sum.',
        example: { input: '4096', output: '19' },
        constraints: ['0 ≤ n ≤ 10¹⁸'],
        hints: ['sum(n) = n % 10 + sum(n // 10), with sum(0) = 0.'],
        solution: `def digit_sum(n):
    if n == 0:
        return 0
    return n % 10 + digit_sum(n // 10)


print(digit_sum(int(input())))
`,
      },
    ],
  },
  {
    id: 'dynamic-programming',
    name: 'Dynamic Programming',
    icon: 'table',
    summary: 'Solve overlapping sub-problems once and reuse their answers.',
    points: [
      'DP applies when a problem has optimal substructure and overlapping sub-problems.',
      'Top-down DP = recursion + memoisation; bottom-up DP = filling a table iteratively.',
      'Define the state, the transition (recurrence) and the base cases.',
      'Classic problems: Fibonacci, knapsack, LCS, LIS, coin change, edit distance.',
      'Space can often be reduced by keeping only the previous row or values.',
    ],
    algorithms: ['fibonacci', 'kadane'],
    viva: [
      { q: 'What two properties must a problem have for DP?', a: 'Optimal substructure (an optimal solution is built from optimal sub-solutions) and overlapping sub-problems (the same sub-problems recur).', level: 'beginner' },
      { q: 'What is the difference between memoisation and tabulation?', a: 'Memoisation is top-down: recursive calls store results in a cache. Tabulation is bottom-up: a table is filled in an order where every dependency is already computed.', level: 'beginner' },
      { q: 'Give the recurrence for the 0/1 knapsack problem.', a: 'dp[i][w] = max(dp[i-1][w], value[i] + dp[i-1][w - weight[i]]) if weight[i] ≤ w, otherwise dp[i-1][w].', level: 'advanced' },
      { q: 'How does DP differ from divide and conquer?', a: 'Divide and conquer sub-problems are independent (merge sort), while DP sub-problems overlap, so caching avoids recomputation.', level: 'advanced' },
    ],
    mcq: [
      { q: 'Memoised Fibonacci runs in:', options: ['O(2ⁿ)', 'O(n²)', 'O(n)', 'O(log n)'], answer: 2, explanation: 'Each fib(k) for k ≤ n is computed once.', level: 'beginner' },
      { q: 'Which problem is NOT typically solved with DP?', options: ['Longest common subsequence', 'Coin change', 'Binary search', 'Edit distance'], answer: 2, explanation: 'Binary search has no overlapping sub-problems.', level: 'beginner' },
      { q: 'Time complexity of the classic LCS table for strings of length m and n:', options: ['O(m + n)', 'O(mn)', 'O(2^(m+n))', 'O(m log n)'], answer: 1, explanation: 'The table has m × n cells, each filled in O(1).', level: 'advanced' },
      { q: "Kadane's algorithm is an example of:", options: ['Greedy only', 'DP with O(1) state', 'Backtracking', 'Graph search'], answer: 1, explanation: 'best-ending-here depends only on the previous state.', level: 'advanced' },
    ],
    practice: [
      {
        id: 'dp-stairs',
        title: 'Climbing stairs',
        difficulty: 'Easy',
        statement: 'You can climb 1 or 2 steps at a time. In how many ways can you climb n stairs?',
        input: 'n.',
        output: 'Number of ways.',
        example: { input: '5', output: '8' },
        constraints: ['1 ≤ n ≤ 45'],
        hints: ['ways(n) = ways(n-1) + ways(n-2) — it is Fibonacci.'],
        solution: `n = int(input())
a = 1
b = 1
for _ in range(n - 1):
    a, b = b, a + b
print(b)
`,
      },
      {
        id: 'dp-coins',
        title: 'Coin change (minimum coins)',
        difficulty: 'Medium',
        statement: 'Given coin denominations and an amount, print the minimum number of coins needed, or -1.',
        input: 'n and amount, then n coin values.',
        output: 'Minimum coins.',
        example: { input: '3 11\n1 2 5', output: '3' },
        constraints: ['1 ≤ amount ≤ 10⁴'],
        hints: ['dp[x] = 1 + min(dp[x - c]) over all coins c ≤ x.', 'Initialise dp[0] = 0 and others to infinity.'],
        solution: `n, amount = map(int, input().split())
coins = list(map(int, input().split()))
INF = amount + 1
dp = [0] + [INF] * amount
for x in range(1, amount + 1):
    for c in coins:
        if c <= x and dp[x - c] + 1 < dp[x]:
            dp[x] = dp[x - c] + 1
print(dp[amount] if dp[amount] < INF else -1)
`,
      },
    ],
  },
];

export function findTopic(id: string) {
  return TOPICS.find((t) => t.id === id);
}
