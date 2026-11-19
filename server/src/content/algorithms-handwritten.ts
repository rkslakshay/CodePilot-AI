import type { AlgorithmDef } from './algorithms.js';

const term = 'classDef dec fill:#2a2350,stroke:#8B7CFF,color:#F1F3F8\n    classDef io fill:#123a33,stroke:#35C9A5,color:#F1F3F8\n    classDef term fill:#1d2433,stroke:#929BAD,color:#F1F3F8';

export const HANDWRITTEN: AlgorithmDef[] = [
  {
    id: 'stack',
    name: 'Stack (LIFO)',
    category: 'Data Structures',
    difficulty: 'Easy',
    summary: 'Last-in, first-out collection with push, pop and peek.',
    description:
      'A stack only allows access to its top element. push adds an element on top, pop removes the top element and peek reads it without removing it. Stacks power function calls (the call stack), undo features, expression evaluation and depth-first search. This implementation uses an array plus a top index; overflow and underflow are checked.',
    input: 'A sequence of push / pop operations.',
    output: 'The popped values and the remaining stack.',
    steps: ['push(x): if top == capacity - 1 report overflow, else top = top + 1 and data[top] = x.', 'pop(): if top == -1 report underflow, else return data[top] and decrease top.', 'peek(): return data[top] without removing it.', 'isEmpty(): top == -1.'],
    complexity: { best: 'O(1)', average: 'O(1)', worst: 'O(1)', space: 'O(n)', note: 'Every operation is constant time.' },
    example: { input: 'push 10, push 20, push 30, pop, peek', output: 'Popped 30, top is 20', explanation: '30 was pushed last, so it is popped first.' },
    keywords: ['stack', 'lifo', 'push pop', 'stack implementation', 'last in first out'],
    visual: 'stack',
    defaultInput: 'push 10, push 20, push 30, pop, push 40, pop, pop',
    focus: 'push',
    source: 'handwritten',
    expectedOutput: 'Popped: 30\nTop element: 20\nStack size: 2\n',
    python: `class Stack:
    def __init__(self):
        self.items = []

    def push(self, x):
        self.items.append(x)

    def pop(self):
        if self.is_empty():
            raise IndexError("stack underflow")
        return self.items.pop()

    def peek(self):
        return self.items[-1]

    def is_empty(self):
        return len(self.items) == 0


s = Stack()
s.push(10)
s.push(20)
s.push(30)
print("Popped:", s.pop())
print("Top element:", s.peek())
print("Stack size:", len(s.items))
`,
    code: {
      c: `#include <stdio.h>
#define CAPACITY 100

int stack[CAPACITY];
int top = -1;

void push(int x) {
    if (top == CAPACITY - 1) {
        printf("Stack overflow\\n");
        return;
    }
    stack[++top] = x;
}

int pop(void) {
    if (top == -1) {
        printf("Stack underflow\\n");
        return -1;
    }
    return stack[top--];
}

int peek(void) {
    return stack[top];
}

int main() {
    push(10);
    push(20);
    push(30);
    printf("Popped: %d\\n", pop());
    printf("Top element: %d\\n", peek());
    printf("Stack size: %d\\n", top + 1);
    return 0;
}
`,
      cpp: `#include <iostream>
#include <vector>
#include <stdexcept>
using namespace std;

class Stack {
    vector<int> items;
public:
    void push(int x) { items.push_back(x); }
    int pop() {
        if (items.empty()) throw runtime_error("stack underflow");
        int x = items.back();
        items.pop_back();
        return x;
    }
    int peek() const { return items.back(); }
    bool isEmpty() const { return items.empty(); }
    int size() const { return (int)items.size(); }
};

int main() {
    Stack s;
    s.push(10);
    s.push(20);
    s.push(30);
    cout << "Popped: " << s.pop() << endl;
    cout << "Top element: " << s.peek() << endl;
    cout << "Stack size: " << s.size() << endl;
    return 0;
}
`,
      java: `import java.util.ArrayList;

public class Main {
    static class Stack {
        private final ArrayList<Integer> items = new ArrayList<>();

        void push(int x) { items.add(x); }

        int pop() {
            if (items.isEmpty()) throw new RuntimeException("stack underflow");
            return items.remove(items.size() - 1);
        }

        int peek() { return items.get(items.size() - 1); }

        int size() { return items.size(); }
    }

    public static void main(String[] args) {
        Stack s = new Stack();
        s.push(10);
        s.push(20);
        s.push(30);
        System.out.println("Popped: " + s.pop());
        System.out.println("Top element: " + s.peek());
        System.out.println("Stack size: " + s.size());
    }
}
`,
      javascript: `class Stack {
  constructor() {
    this.items = [];
  }
  push(x) {
    this.items.push(x);
  }
  pop() {
    if (this.items.length === 0) throw new Error("stack underflow");
    return this.items.pop();
  }
  peek() {
    return this.items[this.items.length - 1];
  }
  get size() {
    return this.items.length;
  }
}

const s = new Stack();
s.push(10);
s.push(20);
s.push(30);
console.log("Popped: " + s.pop());
console.log("Top element: " + s.peek());
console.log("Stack size: " + s.size);
`,
    },
    pseudocode: `PROCEDURE push(x)
    IF top = CAPACITY - 1 THEN
        PRINT "Stack overflow"
        RETURN
    END IF
    top ← top + 1
    data[top] ← x
END PROCEDURE

FUNCTION pop()
    IF top = -1 THEN
        PRINT "Stack underflow"
        RETURN -1
    END IF
    x ← data[top]
    top ← top - 1
    RETURN x
END FUNCTION`,
    flowchart: `flowchart TD
    N1(["push(x)"]) --> N2{"top = CAPACITY - 1?"}
    N2 -->|Yes| N3[/"Output: Stack overflow"/]
    N2 -->|No| N4["top = top + 1"]
    N4 --> N5["data[top] = x"]
    N3 --> N6(["End"])
    N5 --> N6
    ${term}
    class N2 dec
    class N3 io
    class N1,N6 term`,
  },
  {
    id: 'queue',
    name: 'Queue (FIFO)',
    category: 'Data Structures',
    difficulty: 'Easy',
    summary: 'First-in, first-out collection with enqueue and dequeue.',
    description:
      'A queue adds elements at the rear and removes them from the front, like a line of people. This version is a circular buffer: front and rear indexes wrap around the end of a fixed-size array so freed slots are reused. Queues are used in BFS, scheduling and buffering.',
    input: 'A sequence of enqueue / dequeue operations.',
    output: 'The dequeued values in arrival order.',
    steps: ['enqueue(x): if size == capacity report overflow; else rear = (rear + 1) mod capacity, data[rear] = x, size++.', 'dequeue(): if size == 0 report underflow; else x = data[front], front = (front + 1) mod capacity, size--.', 'peek(): data[front].'],
    complexity: { best: 'O(1)', average: 'O(1)', worst: 'O(1)', space: 'O(n)' },
    example: { input: 'enqueue 10, 20, 30, dequeue, dequeue', output: 'Dequeued 10, then 20', explanation: 'Elements leave in the same order they arrived.' },
    keywords: ['queue', 'fifo', 'enqueue dequeue', 'circular queue', 'first in first out'],
    visual: 'queue',
    defaultInput: 'enqueue 10, enqueue 20, enqueue 30, dequeue, enqueue 40, dequeue',
    focus: 'enqueue',
    source: 'handwritten',
    expectedOutput: 'Dequeued: 10\nDequeued: 20\nFront element: 30\nQueue size: 2\n',
    python: `from collections import deque

queue = deque()
queue.append(10)
queue.append(20)
queue.append(30)
print("Dequeued:", queue.popleft())
print("Dequeued:", queue.popleft())
queue.append(40)
print("Front element:", queue[0])
print("Queue size:", len(queue))
`,
    code: {
      c: `#include <stdio.h>
#define CAPACITY 5

int data[CAPACITY];
int front = 0, rear = -1, size = 0;

void enqueue(int x) {
    if (size == CAPACITY) {
        printf("Queue overflow\\n");
        return;
    }
    rear = (rear + 1) % CAPACITY;
    data[rear] = x;
    size++;
}

int dequeue(void) {
    if (size == 0) {
        printf("Queue underflow\\n");
        return -1;
    }
    int x = data[front];
    front = (front + 1) % CAPACITY;
    size--;
    return x;
}

int main() {
    enqueue(10);
    enqueue(20);
    enqueue(30);
    printf("Dequeued: %d\\n", dequeue());
    printf("Dequeued: %d\\n", dequeue());
    enqueue(40);
    printf("Front element: %d\\n", data[front]);
    printf("Queue size: %d\\n", size);
    return 0;
}
`,
      cpp: `#include <iostream>
#include <queue>
using namespace std;

int main() {
    queue<int> q;
    q.push(10);
    q.push(20);
    q.push(30);
    cout << "Dequeued: " << q.front() << endl;
    q.pop();
    cout << "Dequeued: " << q.front() << endl;
    q.pop();
    q.push(40);
    cout << "Front element: " << q.front() << endl;
    cout << "Queue size: " << q.size() << endl;
    return 0;
}
`,
      java: `import java.util.ArrayDeque;
import java.util.Queue;

public class Main {
    public static void main(String[] args) {
        Queue<Integer> q = new ArrayDeque<>();
        q.offer(10);
        q.offer(20);
        q.offer(30);
        System.out.println("Dequeued: " + q.poll());
        System.out.println("Dequeued: " + q.poll());
        q.offer(40);
        System.out.println("Front element: " + q.peek());
        System.out.println("Queue size: " + q.size());
    }
}
`,
      javascript: `class Queue {
  constructor() {
    this.items = {};
    this.head = 0;
    this.tail = 0;
  }
  enqueue(x) {
    this.items[this.tail++] = x;
  }
  dequeue() {
    if (this.size === 0) throw new Error("queue underflow");
    const x = this.items[this.head];
    delete this.items[this.head++];
    return x;
  }
  peek() {
    return this.items[this.head];
  }
  get size() {
    return this.tail - this.head;
  }
}

const q = new Queue();
q.enqueue(10);
q.enqueue(20);
q.enqueue(30);
console.log("Dequeued: " + q.dequeue());
console.log("Dequeued: " + q.dequeue());
q.enqueue(40);
console.log("Front element: " + q.peek());
console.log("Queue size: " + q.size);
`,
    },
    pseudocode: `PROCEDURE enqueue(x)
    IF size = CAPACITY THEN
        PRINT "Queue overflow"
        RETURN
    END IF
    rear ← (rear + 1) MOD CAPACITY
    data[rear] ← x
    size ← size + 1
END PROCEDURE

FUNCTION dequeue()
    IF size = 0 THEN
        PRINT "Queue underflow"
        RETURN -1
    END IF
    x ← data[front]
    front ← (front + 1) MOD CAPACITY
    size ← size - 1
    RETURN x
END FUNCTION`,
    flowchart: `flowchart TD
    N1(["dequeue()"]) --> N2{"size = 0?"}
    N2 -->|Yes| N3[/"Output: Queue underflow"/]
    N2 -->|No| N4["x = data[front]"]
    N4 --> N5["front = (front + 1) mod CAPACITY<br/>size = size - 1"]
    N5 --> N6[/"Return x"/]
    N3 --> N7(["End"])
    N6 --> N7
    ${term}
    class N2 dec
    class N3,N6 io
    class N1,N7 term`,
  },
  {
    id: 'linked-list',
    name: 'Singly Linked List',
    category: 'Data Structures',
    difficulty: 'Medium',
    summary: 'Nodes connected by next-pointers; O(1) insertion at the head.',
    description:
      'A linked list stores elements in nodes; each node holds a value and a reference to the next node. Inserting or deleting at a known position only re-links pointers (no shifting), but reaching the k-th element requires walking from the head. This implementation supports insertion at the head and tail, deletion by value, and traversal.',
    input: 'A sequence of insert / delete operations.',
    output: 'The list contents after the operations.',
    steps: [
      'insertAtHead(x): create a node whose next is the current head; make it the head.',
      'insertAtTail(x): walk to the last node and set its next to the new node.',
      'delete(x): find the node before the one holding x and bypass it (prev.next = node.next).',
      'traverse: start at head and follow next until null.',
    ],
    complexity: { best: 'O(1)', average: 'O(n)', worst: 'O(n)', space: 'O(n)', note: 'Head insertion O(1); search, tail insertion and deletion O(n).' },
    example: { input: 'insert 10, 20, 30 at tail; insert 5 at head; delete 20', output: '5 -> 10 -> 30 -> NULL', explanation: 'Deleting 20 links node 10 directly to node 30.' },
    keywords: ['linked list', 'singly linked list', 'node pointer', 'insert node', 'delete node', 'traverse list'],
    visual: 'linkedlist',
    defaultInput: 'tail 10, tail 20, tail 30, head 5, delete 20',
    focus: 'insert',
    source: 'handwritten',
    expectedOutput: '5 -> 10 -> 20 -> 30 -> NULL\n5 -> 10 -> 30 -> NULL\n',
    python: `class Node:
    def __init__(self, value):
        self.value = value
        self.next = None


class LinkedList:
    def __init__(self):
        self.head = None

    def insert_at_head(self, value):
        node = Node(value)
        node.next = self.head
        self.head = node

    def insert_at_tail(self, value):
        node = Node(value)
        if self.head is None:
            self.head = node
            return
        cur = self.head
        while cur.next is not None:
            cur = cur.next
        cur.next = node

    def delete(self, value):
        if self.head is None:
            return
        if self.head.value == value:
            self.head = self.head.next
            return
        cur = self.head
        while cur.next is not None and cur.next.value != value:
            cur = cur.next
        if cur.next is not None:
            cur.next = cur.next.next

    def display(self):
        cur = self.head
        while cur is not None:
            print(cur.value, end=" -> ")
            cur = cur.next
        print("NULL")


lst = LinkedList()
lst.insert_at_tail(10)
lst.insert_at_tail(20)
lst.insert_at_tail(30)
lst.insert_at_head(5)
lst.display()
lst.delete(20)
lst.display()
`,
    code: {
      c: `#include <stdio.h>
#include <stdlib.h>

struct Node {
    int value;
    struct Node *next;
};

struct Node *head = NULL;

struct Node *createNode(int value) {
    struct Node *node = (struct Node *)malloc(sizeof(struct Node));
    node->value = value;
    node->next = NULL;
    return node;
}

void insertAtHead(int value) {
    struct Node *node = createNode(value);
    node->next = head;
    head = node;
}

void insertAtTail(int value) {
    struct Node *node = createNode(value);
    if (head == NULL) {
        head = node;
        return;
    }
    struct Node *cur = head;
    while (cur->next != NULL) cur = cur->next;
    cur->next = node;
}

void deleteValue(int value) {
    if (head == NULL) return;
    if (head->value == value) {
        struct Node *old = head;
        head = head->next;
        free(old);
        return;
    }
    struct Node *cur = head;
    while (cur->next != NULL && cur->next->value != value) cur = cur->next;
    if (cur->next != NULL) {
        struct Node *old = cur->next;
        cur->next = old->next;
        free(old);
    }
}

void display(void) {
    for (struct Node *cur = head; cur != NULL; cur = cur->next) printf("%d -> ", cur->value);
    printf("NULL\\n");
}

int main() {
    insertAtTail(10);
    insertAtTail(20);
    insertAtTail(30);
    insertAtHead(5);
    display();
    deleteValue(20);
    display();
    while (head != NULL) deleteValue(head->value);
    return 0;
}
`,
      cpp: `#include <iostream>
using namespace std;

struct Node {
    int value;
    Node *next;
    Node(int v) : value(v), next(nullptr) {}
};

class LinkedList {
    Node *head = nullptr;
public:
    ~LinkedList() {
        while (head) {
            Node *n = head->next;
            delete head;
            head = n;
        }
    }
    void insertAtHead(int value) {
        Node *node = new Node(value);
        node->next = head;
        head = node;
    }
    void insertAtTail(int value) {
        Node *node = new Node(value);
        if (!head) { head = node; return; }
        Node *cur = head;
        while (cur->next) cur = cur->next;
        cur->next = node;
    }
    void remove(int value) {
        if (!head) return;
        if (head->value == value) {
            Node *old = head;
            head = head->next;
            delete old;
            return;
        }
        Node *cur = head;
        while (cur->next && cur->next->value != value) cur = cur->next;
        if (cur->next) {
            Node *old = cur->next;
            cur->next = old->next;
            delete old;
        }
    }
    void display() const {
        for (Node *cur = head; cur; cur = cur->next) cout << cur->value << " -> ";
        cout << "NULL" << endl;
    }
};

int main() {
    LinkedList list;
    list.insertAtTail(10);
    list.insertAtTail(20);
    list.insertAtTail(30);
    list.insertAtHead(5);
    list.display();
    list.remove(20);
    list.display();
    return 0;
}
`,
      java: `public class Main {
    static class Node {
        int value;
        Node next;
        Node(int value) { this.value = value; }
    }

    static Node head = null;

    static void insertAtHead(int value) {
        Node node = new Node(value);
        node.next = head;
        head = node;
    }

    static void insertAtTail(int value) {
        Node node = new Node(value);
        if (head == null) { head = node; return; }
        Node cur = head;
        while (cur.next != null) cur = cur.next;
        cur.next = node;
    }

    static void delete(int value) {
        if (head == null) return;
        if (head.value == value) { head = head.next; return; }
        Node cur = head;
        while (cur.next != null && cur.next.value != value) cur = cur.next;
        if (cur.next != null) cur.next = cur.next.next;
    }

    static void display() {
        StringBuilder sb = new StringBuilder();
        for (Node cur = head; cur != null; cur = cur.next) sb.append(cur.value).append(" -> ");
        System.out.println(sb.append("NULL"));
    }

    public static void main(String[] args) {
        insertAtTail(10);
        insertAtTail(20);
        insertAtTail(30);
        insertAtHead(5);
        display();
        delete(20);
        display();
    }
}
`,
      javascript: `class Node {
  constructor(value) {
    this.value = value;
    this.next = null;
  }
}

class LinkedList {
  constructor() {
    this.head = null;
  }
  insertAtHead(value) {
    const node = new Node(value);
    node.next = this.head;
    this.head = node;
  }
  insertAtTail(value) {
    const node = new Node(value);
    if (!this.head) {
      this.head = node;
      return;
    }
    let cur = this.head;
    while (cur.next) cur = cur.next;
    cur.next = node;
  }
  delete(value) {
    if (!this.head) return;
    if (this.head.value === value) {
      this.head = this.head.next;
      return;
    }
    let cur = this.head;
    while (cur.next && cur.next.value !== value) cur = cur.next;
    if (cur.next) cur.next = cur.next.next;
  }
  display() {
    let out = "";
    for (let cur = this.head; cur; cur = cur.next) out += cur.value + " -> ";
    console.log(out + "NULL");
  }
}

const list = new LinkedList();
list.insertAtTail(10);
list.insertAtTail(20);
list.insertAtTail(30);
list.insertAtHead(5);
list.display();
list.delete(20);
list.display();
`,
    },
    pseudocode: `PROCEDURE insertAtTail(x)
    node ← new Node(x)
    IF head = NULL THEN
        head ← node
        RETURN
    END IF
    cur ← head
    WHILE cur.next ≠ NULL DO
        cur ← cur.next
    END WHILE
    cur.next ← node
END PROCEDURE

PROCEDURE delete(x)
    IF head = NULL THEN RETURN
    IF head.value = x THEN
        head ← head.next
        RETURN
    END IF
    cur ← head
    WHILE cur.next ≠ NULL AND cur.next.value ≠ x DO
        cur ← cur.next
    END WHILE
    IF cur.next ≠ NULL THEN
        cur.next ← cur.next.next
    END IF
END PROCEDURE`,
    flowchart: `flowchart TD
    N1(["insertAtTail(x)"]) --> N2["node = new Node(x)"]
    N2 --> N3{"head = NULL?"}
    N3 -->|Yes| N4["head = node"]
    N3 -->|No| N5["cur = head"]
    N5 --> N6{"cur.next ≠ NULL?"}
    N6 -->|Yes| N7["cur = cur.next"]
    N7 --> N6
    N6 -->|No| N8["cur.next = node"]
    N4 --> N9(["End"])
    N8 --> N9
    ${term}
    class N3,N6 dec
    class N1,N9 term`,
  },
  {
    id: 'bst',
    name: 'Binary Search Tree',
    category: 'Data Structures',
    difficulty: 'Medium',
    summary: 'Ordered binary tree: left < node < right.',
    description:
      'In a binary search tree every node’s left subtree contains smaller keys and its right subtree larger keys. Search and insertion follow a single path from the root, so they take time proportional to the height: O(log n) for a balanced tree, O(n) for a degenerate one. An in-order traversal visits the keys in sorted order.',
    input: 'A sequence of keys to insert and a key to search.',
    output: 'In-order traversal and search results.',
    steps: [
      'insert(node, x): if node is empty create a new node; if x < node.key insert into the left subtree, otherwise into the right subtree.',
      'search(node, x): if node is empty → not found; if x equals node.key → found; go left if smaller, right if larger.',
      'inorder(node): inorder(left), visit node, inorder(right).',
    ],
    complexity: { best: 'O(log n)', average: 'O(log n)', worst: 'O(n)', space: 'O(n)', note: 'Worst case when keys are inserted in sorted order.' },
    example: { input: 'insert 50, 30, 70, 20, 40, 60, 80; search 60', output: 'Inorder: 20 30 40 50 60 70 80; 60 found', explanation: '60 > 50 → right; 60 < 70 → left; found.' },
    keywords: ['binary search tree', 'bst', 'tree insert', 'tree search', 'inorder traversal', 'binary tree'],
    visual: 'bst',
    defaultInput: '50, 30, 70, 20, 40, 60, 80 | 60',
    focus: 'insert',
    source: 'handwritten',
    expectedOutput: 'Inorder: 20 30 40 50 60 70 80 \nSearch 60: found\nSearch 65: not found\n',
    python: `class Node:
    def __init__(self, key):
        self.key = key
        self.left = None
        self.right = None


def insert(root, key):
    if root is None:
        return Node(key)
    if key < root.key:
        root.left = insert(root.left, key)
    else:
        root.right = insert(root.right, key)
    return root


def search(root, key):
    if root is None:
        return False
    if key == root.key:
        return True
    if key < root.key:
        return search(root.left, key)
    return search(root.right, key)


def inorder(root):
    if root is not None:
        inorder(root.left)
        print(root.key, end=" ")
        inorder(root.right)


root = None
for key in [50, 30, 70, 20, 40, 60, 80]:
    root = insert(root, key)
print("Inorder:", end=" ")
inorder(root)
print()
print("Search 60:", "found" if search(root, 60) else "not found")
print("Search 65:", "found" if search(root, 65) else "not found")
`,
    code: {
      c: `#include <stdio.h>
#include <stdlib.h>

struct Node {
    int key;
    struct Node *left, *right;
};

struct Node *insert(struct Node *root, int key) {
    if (root == NULL) {
        struct Node *n = (struct Node *)malloc(sizeof(struct Node));
        n->key = key;
        n->left = n->right = NULL;
        return n;
    }
    if (key < root->key) root->left = insert(root->left, key);
    else root->right = insert(root->right, key);
    return root;
}

int search(struct Node *root, int key) {
    if (root == NULL) return 0;
    if (key == root->key) return 1;
    return key < root->key ? search(root->left, key) : search(root->right, key);
}

void inorder(struct Node *root) {
    if (root == NULL) return;
    inorder(root->left);
    printf("%d ", root->key);
    inorder(root->right);
}

void freeTree(struct Node *root) {
    if (root == NULL) return;
    freeTree(root->left);
    freeTree(root->right);
    free(root);
}

int main() {
    int keys[] = {50, 30, 70, 20, 40, 60, 80};
    struct Node *root = NULL;
    for (int i = 0; i < 7; i++) root = insert(root, keys[i]);
    printf("Inorder: ");
    inorder(root);
    printf("\\n");
    printf("Search 60: %s\\n", search(root, 60) ? "found" : "not found");
    printf("Search 65: %s\\n", search(root, 65) ? "found" : "not found");
    freeTree(root);
    return 0;
}
`,
      cpp: `#include <iostream>
using namespace std;

struct Node {
    int key;
    Node *left = nullptr, *right = nullptr;
    Node(int k) : key(k) {}
};

Node *insert(Node *root, int key) {
    if (!root) return new Node(key);
    if (key < root->key) root->left = insert(root->left, key);
    else root->right = insert(root->right, key);
    return root;
}

bool search(Node *root, int key) {
    if (!root) return false;
    if (key == root->key) return true;
    return key < root->key ? search(root->left, key) : search(root->right, key);
}

void inorder(Node *root) {
    if (!root) return;
    inorder(root->left);
    cout << root->key << " ";
    inorder(root->right);
}

void destroy(Node *root) {
    if (!root) return;
    destroy(root->left);
    destroy(root->right);
    delete root;
}

int main() {
    Node *root = nullptr;
    for (int key : {50, 30, 70, 20, 40, 60, 80}) root = insert(root, key);
    cout << "Inorder: ";
    inorder(root);
    cout << endl;
    cout << "Search 60: " << (search(root, 60) ? "found" : "not found") << endl;
    cout << "Search 65: " << (search(root, 65) ? "found" : "not found") << endl;
    destroy(root);
    return 0;
}
`,
      java: `public class Main {
    static class Node {
        int key;
        Node left, right;
        Node(int key) { this.key = key; }
    }

    static Node insert(Node root, int key) {
        if (root == null) return new Node(key);
        if (key < root.key) root.left = insert(root.left, key);
        else root.right = insert(root.right, key);
        return root;
    }

    static boolean search(Node root, int key) {
        if (root == null) return false;
        if (key == root.key) return true;
        return key < root.key ? search(root.left, key) : search(root.right, key);
    }

    static void inorder(Node root) {
        if (root == null) return;
        inorder(root.left);
        System.out.print(root.key + " ");
        inorder(root.right);
    }

    public static void main(String[] args) {
        Node root = null;
        for (int key : new int[]{50, 30, 70, 20, 40, 60, 80}) root = insert(root, key);
        System.out.print("Inorder: ");
        inorder(root);
        System.out.println();
        System.out.println("Search 60: " + (search(root, 60) ? "found" : "not found"));
        System.out.println("Search 65: " + (search(root, 65) ? "found" : "not found"));
    }
}
`,
      javascript: `class Node {
  constructor(key) {
    this.key = key;
    this.left = null;
    this.right = null;
  }
}

function insert(root, key) {
  if (!root) return new Node(key);
  if (key < root.key) root.left = insert(root.left, key);
  else root.right = insert(root.right, key);
  return root;
}

function search(root, key) {
  if (!root) return false;
  if (key === root.key) return true;
  return key < root.key ? search(root.left, key) : search(root.right, key);
}

function inorder(root, out) {
  if (!root) return out;
  inorder(root.left, out);
  out.push(root.key);
  inorder(root.right, out);
  return out;
}

let root = null;
for (const key of [50, 30, 70, 20, 40, 60, 80]) root = insert(root, key);
console.log("Inorder: " + inorder(root, []).join(" ") + " ");
console.log("Search 60: " + (search(root, 60) ? "found" : "not found"));
console.log("Search 65: " + (search(root, 65) ? "found" : "not found"));
`,
    },
    pseudocode: `FUNCTION insert(node, key)
    IF node = NULL THEN
        RETURN new Node(key)
    END IF
    IF key < node.key THEN
        node.left ← insert(node.left, key)
    ELSE
        node.right ← insert(node.right, key)
    END IF
    RETURN node
END FUNCTION

FUNCTION search(node, key)
    IF node = NULL THEN RETURN FALSE
    IF key = node.key THEN RETURN TRUE
    IF key < node.key THEN RETURN search(node.left, key)
    RETURN search(node.right, key)
END FUNCTION`,
    flowchart: `flowchart TD
    N1(["search(node, key)"]) --> N2{"node = NULL?"}
    N2 -->|Yes| N3[/"Return not found"/]
    N2 -->|No| N4{"key = node.key?"}
    N4 -->|Yes| N5[/"Return found"/]
    N4 -->|No| N6{"key < node.key?"}
    N6 -->|Yes| N7["node = node.left"]
    N6 -->|No| N8["node = node.right"]
    N7 --> N2
    N8 --> N2
    N3 --> N9(["End"])
    N5 --> N9
    ${term}
    class N2,N4,N6 dec
    class N3,N5 io
    class N1,N9 term`,
  },
  {
    id: 'hash-table',
    name: 'Hash Table (Chaining)',
    category: 'Data Structures',
    difficulty: 'Medium',
    summary: 'Key → value storage with average O(1) lookup.',
    description:
      'A hash table turns a key into an array index with a hash function (here key mod size). Different keys can land in the same bucket — a collision — so each bucket stores a small chain (list) of entries. With a good hash function and a low load factor, insert, search and delete take constant time on average.',
    input: 'A sequence of (key, value) insertions and lookups.',
    output: 'The bucket layout and lookup results.',
    steps: [
      'index = hash(key) = key mod SIZE.',
      'insert: if the key exists in bucket[index], update it; otherwise append (key, value) to the chain.',
      'search: walk the chain in bucket[index] and compare keys.',
      'delete: remove the matching entry from the chain.',
    ],
    complexity: { best: 'O(1)', average: 'O(1)', worst: 'O(n)', space: 'O(n)', note: 'Worst case when every key collides into one bucket.' },
    example: { input: 'SIZE = 7; insert 10, 20, 15, 7, 24', output: 'bucket 3: 10 → 24 (collision)', explanation: '10 mod 7 = 3 and 24 mod 7 = 3, so both live in bucket 3.' },
    keywords: ['hash table', 'hashing', 'hash map', 'collision', 'chaining', 'dictionary'],
    visual: 'hash',
    defaultInput: '10, 20, 15, 7, 24, 31',
    focus: 'insert',
    source: 'handwritten',
    expectedOutput: 'Bucket 0: 7\nBucket 1: 15\nBucket 2: \nBucket 3: 10 24\nBucket 4: \nBucket 5: \nBucket 6: 20\nValue for 24: 240\n',
    python: `SIZE = 7
table = [[] for _ in range(SIZE)]


def insert(key, value):
    bucket = table[key % SIZE]
    for pair in bucket:
        if pair[0] == key:
            pair[1] = value
            return
    bucket.append([key, value])


def search(key):
    for pair in table[key % SIZE]:
        if pair[0] == key:
            return pair[1]
    return None


for k in [10, 20, 15, 7, 24]:
    insert(k, k * 10)
for i in range(SIZE):
    print(f"Bucket {i}:", " ".join(str(p[0]) for p in table[i]))
print("Value for 24:", search(24))
`,
    code: {
      c: `#include <stdio.h>
#include <stdlib.h>
#define SIZE 7

struct Entry {
    int key, value;
    struct Entry *next;
};

struct Entry *table[SIZE];

void insert(int key, int value) {
    int idx = key % SIZE;
    for (struct Entry *e = table[idx]; e; e = e->next) {
        if (e->key == key) { e->value = value; return; }
    }
    struct Entry *e = (struct Entry *)malloc(sizeof(struct Entry));
    e->key = key;
    e->value = value;
    e->next = NULL;
    if (!table[idx]) { table[idx] = e; return; }
    struct Entry *cur = table[idx];
    while (cur->next) cur = cur->next;
    cur->next = e;
}

int search(int key, int *found) {
    for (struct Entry *e = table[key % SIZE]; e; e = e->next) {
        if (e->key == key) { *found = 1; return e->value; }
    }
    *found = 0;
    return 0;
}

int main() {
    int keys[] = {10, 20, 15, 7, 24};
    for (int i = 0; i < 5; i++) insert(keys[i], keys[i] * 10);
    for (int i = 0; i < SIZE; i++) {
        printf("Bucket %d: ", i);
        int first = 1;
        for (struct Entry *e = table[i]; e; e = e->next) {
            printf(first ? "%d" : " %d", e->key);
            first = 0;
        }
        printf("\\n");
    }
    int found;
    int v = search(24, &found);
    printf("Value for 24: %d\\n", v);
    return 0;
}
`,
      cpp: `#include <iostream>
#include <list>
#include <vector>
#include <utility>
using namespace std;

const int SIZE = 7;
vector<list<pair<int, int>>> table(SIZE);

void insert(int key, int value) {
    auto &bucket = table[key % SIZE];
    for (auto &p : bucket) {
        if (p.first == key) { p.second = value; return; }
    }
    bucket.push_back({key, value});
}

bool search(int key, int &value) {
    for (auto &p : table[key % SIZE]) {
        if (p.first == key) { value = p.second; return true; }
    }
    return false;
}

int main() {
    for (int k : {10, 20, 15, 7, 24}) insert(k, k * 10);
    for (int i = 0; i < SIZE; i++) {
        cout << "Bucket " << i << ": ";
        bool first = true;
        for (auto &p : table[i]) {
            cout << (first ? "" : " ") << p.first;
            first = false;
        }
        cout << endl;
    }
    int v;
    if (search(24, v)) cout << "Value for 24: " << v << endl;
    return 0;
}
`,
      java: `import java.util.LinkedList;

public class Main {
    static final int SIZE = 7;
    @SuppressWarnings("unchecked")
    static LinkedList<int[]>[] table = new LinkedList[SIZE];

    static void insert(int key, int value) {
        int idx = key % SIZE;
        if (table[idx] == null) table[idx] = new LinkedList<>();
        for (int[] p : table[idx]) {
            if (p[0] == key) { p[1] = value; return; }
        }
        table[idx].add(new int[]{key, value});
    }

    static Integer search(int key) {
        LinkedList<int[]> bucket = table[key % SIZE];
        if (bucket == null) return null;
        for (int[] p : bucket) if (p[0] == key) return p[1];
        return null;
    }

    public static void main(String[] args) {
        for (int k : new int[]{10, 20, 15, 7, 24}) insert(k, k * 10);
        for (int i = 0; i < SIZE; i++) {
            StringBuilder sb = new StringBuilder("Bucket " + i + ": ");
            if (table[i] != null) {
                boolean first = true;
                for (int[] p : table[i]) {
                    sb.append(first ? "" : " ").append(p[0]);
                    first = false;
                }
            }
            System.out.println(sb);
        }
        System.out.println("Value for 24: " + search(24));
    }
}
`,
      javascript: `const SIZE = 7;
const table = Array.from({ length: SIZE }, () => []);

function insert(key, value) {
  const bucket = table[key % SIZE];
  for (const pair of bucket) {
    if (pair[0] === key) {
      pair[1] = value;
      return;
    }
  }
  bucket.push([key, value]);
}

function search(key) {
  for (const pair of table[key % SIZE]) {
    if (pair[0] === key) return pair[1];
  }
  return undefined;
}

for (const k of [10, 20, 15, 7, 24]) insert(k, k * 10);
for (let i = 0; i < SIZE; i++) {
  console.log("Bucket " + i + ": " + table[i].map((p) => p[0]).join(" "));
}
console.log("Value for 24: " + search(24));
`,
    },
    pseudocode: `FUNCTION hash(key)
    RETURN key MOD SIZE
END FUNCTION

PROCEDURE insert(key, value)
    bucket ← table[hash(key)]
    FOR EACH entry IN bucket DO
        IF entry.key = key THEN
            entry.value ← value
            RETURN
        END IF
    END FOR
    APPEND (key, value) TO bucket
END PROCEDURE

FUNCTION search(key)
    FOR EACH entry IN table[hash(key)] DO
        IF entry.key = key THEN RETURN entry.value
    END FOR
    RETURN NOT FOUND
END FUNCTION`,
    flowchart: `flowchart TD
    N1(["insert(key, value)"]) --> N2["index = key mod SIZE"]
    N2 --> N3{"More entries in bucket[index]?"}
    N3 -->|Yes| N4{"entry.key = key?"}
    N4 -->|Yes| N5["entry.value = value"]
    N4 -->|No| N3
    N3 -->|No| N6["append (key, value) to bucket"]
    N5 --> N7(["End"])
    N6 --> N7
    ${term}
    class N3,N4 dec
    class N1,N7 term`,
  },
  {
    id: 'two-sum',
    name: 'Two Sum',
    category: 'Arrays',
    difficulty: 'Easy',
    summary: 'Find two numbers that add up to a target using a hash map.',
    description:
      'Given an array and a target, find indices i < j with arr[i] + arr[j] = target. The brute-force approach checks every pair in O(n²). The hash-map approach walks the array once: for each element x it checks whether target - x was seen before; if not, it records x with its index. This trades O(n) memory for O(n) time.',
    input: 'An array of integers and a target sum.',
    output: 'The two indices whose values add up to the target.',
    steps: [
      'Create an empty map from value → index.',
      'For each index i with value x: compute need = target - x.',
      'If need is in the map, return (map[need], i).',
      'Otherwise store map[x] = i and continue.',
    ],
    complexity: { best: 'O(1)', average: 'O(n)', worst: 'O(n)', space: 'O(n)', note: 'The C version uses the O(n²) pair check because C has no built-in hash map.' },
    example: { input: 'arr = [2, 7, 11, 15], target = 9', output: 'Indices 0 and 1', explanation: 'At index 1, need = 9 - 7 = 2, which was stored at index 0.' },
    keywords: ['two sum', 'pair with sum', 'target sum pair', 'find two numbers', 'pair sum', 'sum equals target'],
    visual: 'twosum',
    defaultInput: '2, 7, 11, 15 | 9',
    focus: 'two_sum',
    source: 'handwritten',
    expectedOutput: 'Indices: 0 and 1\n',
    python: `def two_sum(nums, target):
    seen = {}
    for i in range(len(nums)):
        need = target - nums[i]
        if need in seen:
            return seen[need], i
        seen[nums[i]] = i
    return -1, -1


i, j = two_sum([2, 7, 11, 15], 9)
print("Indices:", i, "and", j)
`,
    code: {
      c: `#include <stdio.h>

/* C has no built-in hash map, so this version checks every pair: O(n^2). */
int twoSum(int nums[], int n, int target, int *a, int *b) {
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            if (nums[i] + nums[j] == target) {
                *a = i;
                *b = j;
                return 1;
            }
        }
    }
    return 0;
}

int main() {
    int nums[] = {2, 7, 11, 15};
    int a, b;
    if (twoSum(nums, 4, 9, &a, &b)) printf("Indices: %d and %d\\n", a, b);
    else printf("No pair found\\n");
    return 0;
}
`,
      cpp: `#include <iostream>
#include <unordered_map>
#include <vector>
using namespace std;

pair<int, int> twoSum(const vector<int>& nums, int target) {
    unordered_map<int, int> seen;
    for (int i = 0; i < (int)nums.size(); i++) {
        int need = target - nums[i];
        auto it = seen.find(need);
        if (it != seen.end()) return {it->second, i};
        seen[nums[i]] = i;
    }
    return {-1, -1};
}

int main() {
    pair<int, int> r = twoSum({2, 7, 11, 15}, 9);
    cout << "Indices: " << r.first << " and " << r.second << endl;
    return 0;
}
`,
      java: `import java.util.HashMap;

public class Main {
    static int[] twoSum(int[] nums, int target) {
        HashMap<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int need = target - nums[i];
            if (seen.containsKey(need)) return new int[]{seen.get(need), i};
            seen.put(nums[i], i);
        }
        return new int[]{-1, -1};
    }

    public static void main(String[] args) {
        int[] r = twoSum(new int[]{2, 7, 11, 15}, 9);
        System.out.println("Indices: " + r[0] + " and " + r[1]);
    }
}
`,
      javascript: `function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return [-1, -1];
}

const [i, j] = twoSum([2, 7, 11, 15], 9);
console.log("Indices: " + i + " and " + j);
`,
    },
    pseudocode: `FUNCTION twoSum(nums, target)
    seen ← empty map
    FOR i ← 0 TO length(nums) - 1 DO
        need ← target - nums[i]
        IF need IN seen THEN
            RETURN (seen[need], i)
        END IF
        seen[nums[i]] ← i
    END FOR
    RETURN (-1, -1)
END FUNCTION`,
    flowchart: `flowchart TD
    N1(["twoSum(nums, target)"]) --> N2["seen = empty map<br/>i = 0"]
    N2 --> N3{"i < length(nums)?"}
    N3 -->|Yes| N4["need = target - nums[i]"]
    N4 --> N5{"need in seen?"}
    N5 -->|Yes| N6[/"Return seen[need], i"/]
    N5 -->|No| N7["seen[nums[i]] = i<br/>i = i + 1"]
    N7 --> N3
    N3 -->|No| N8[/"Return -1, -1"/]
    N6 --> N9(["End"])
    N8 --> N9
    ${term}
    class N3,N5 dec
    class N6,N8 io
    class N1,N9 term`,
  },
];
