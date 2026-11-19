/** Learning paths and topic categories for the Learning Hub (offline content). */

export type Category = 'Foundations' | 'Linear structures' | 'Non-linear structures' | 'Techniques';

export const TOPIC_CATEGORY: Record<string, Category> = {
  arrays: 'Foundations',
  strings: 'Foundations',
  searching: 'Foundations',
  sorting: 'Foundations',
  recursion: 'Techniques',
  'dynamic-programming': 'Techniques',
  'linked-lists': 'Linear structures',
  stacks: 'Linear structures',
  queues: 'Linear structures',
  trees: 'Non-linear structures',
  graphs: 'Non-linear structures',
};

export const CATEGORIES: Category[] = ['Foundations', 'Linear structures', 'Non-linear structures', 'Techniques'];

export interface LearningPath {
  id: string;
  name: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  summary: string;
  topics: string[];
}

export const PATHS: LearningPath[] = [
  {
    id: 'dsa-foundations',
    name: 'DSA foundations',
    level: 'Beginner',
    summary: 'Start here: arrays and strings, then the two most-asked algorithm families — searching and sorting.',
    topics: ['arrays', 'strings', 'searching', 'sorting'],
  },
  {
    id: 'linear-structures',
    name: 'Linear data structures',
    level: 'Intermediate',
    summary: 'Pointers and access rules: linked lists, stacks and queues, and where each one is the right tool.',
    topics: ['linked-lists', 'stacks', 'queues'],
  },
  {
    id: 'recursion-to-dp',
    name: 'Recursion to dynamic programming',
    level: 'Intermediate',
    summary: 'Think recursively, then remove repeated work with memoisation and tabulation.',
    topics: ['recursion', 'dynamic-programming'],
  },
  {
    id: 'trees-graphs',
    name: 'Trees and graphs',
    level: 'Advanced',
    summary: 'Hierarchies and networks: traversals, binary search trees, BFS, DFS and shortest paths.',
    topics: ['recursion', 'trees', 'graphs'],
  },
  {
    id: 'exam-revision',
    name: 'Complete exam revision',
    level: 'Advanced',
    summary: 'Every topic in a sensible order — use it for end-of-semester or placement preparation.',
    topics: ['arrays', 'strings', 'searching', 'sorting', 'recursion', 'linked-lists', 'stacks', 'queues', 'trees', 'graphs', 'dynamic-programming'],
  },
];
