export const CODEGLE_LANGUAGES = [
  { id: 'python', label: 'Python', extension: 'py' },
  { id: 'java', label: 'Java', extension: 'java' },
  { id: 'cpp', label: 'C++', extension: 'cpp' },
  { id: 'javascript', label: 'JavaScript', extension: 'js' },
];

export const CODEGLE_DIFFICULTIES = [
  { id: 'beginner', label: 'Beginner', description: 'Direct fundamentals and warm-up logic.' },
  { id: 'intermediate', label: 'Intermediate', description: 'Short solutions with a useful observation.' },
  { id: 'advanced', label: 'Advanced', description: 'Compact code after a deeper insight.' },
];

export const CODEGLE_DIFFICULTY_IDS = new Set(CODEGLE_DIFFICULTIES.map(({ id }) => id));

const starters = ({ python, java, cpp, javascript }) => ({ python, java, cpp, javascript });

const readNumbers = (names) => starters({
  python: `${names.join(', ')} = map(int, input().split())\n# Write your solution here\n`,
  java: `import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        long ${names.map((name) => `${name} = in.nextLong()`).join(', ')};\n        // Write your solution here\n    }\n}\n`,
  cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    long long ${names.join(', ')};\n    cin >> ${names.join(' >> ')};\n    // Write your solution here\n    return 0;\n}\n`,
  javascript: `const fs = require('fs');\nconst [${names.join(', ')}] = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\n// Write your solution here\n`,
});

const readList = starters({
  python: "import sys\ndata = list(map(int, sys.stdin.read().split()))\nn, values = data[0], data[1:]\n# Write your solution here\n",
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt();\n        long[] values = new long[n];\n        for (int i = 0; i < n; i++) values[i] = in.nextLong();\n        // Write your solution here\n    }\n}\n',
  cpp: '#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    int n; cin >> n;\n    vector<long long> values(n);\n    for (auto &value : values) cin >> value;\n    // Write your solution here\n    return 0;\n}\n',
  javascript: "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconst n = data[0], values = data.slice(1);\n// Write your solution here\n",
});

export const CODEGLE_PROBLEMS = [
  {
    id: 'sum-two', title: 'Add Two Numbers', difficulty: 'beginner',
    description: 'Read two integers and print their sum.',
    inputFormat: 'One line containing two integers a and b.', outputFormat: 'Print a + b.',
    constraints: ['-1,000,000 ≤ a, b ≤ 1,000,000'], examples: [{ input: '7 11', output: '18' }],
    starter: starters({
      python: 'a, b = map(int, input().split())\n# Write your solution here\n',
      java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int a = in.nextInt();\n        int b = in.nextInt();\n        // Write your solution here\n    }\n}\n',
      cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    long long a, b;\n    cin >> a >> b;\n    // Write your solution here\n    return 0;\n}\n',
      javascript: "const fs = require('fs');\nconst [a, b] = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\n// Write your solution here\n",
    }),
  },
  {
    id: 'even-or-odd', title: 'Even or Odd', difficulty: 'beginner',
    description: 'Read one integer. Print EVEN if it is divisible by 2; otherwise print ODD.',
    inputFormat: 'One integer n.', outputFormat: 'Print EVEN or ODD in uppercase.',
    constraints: ['-1,000,000,000 ≤ n ≤ 1,000,000,000'], examples: [{ input: '17', output: 'ODD' }],
    starter: starters({
      python: 'n = int(input())\n# Write your solution here\n',
      java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt();\n        // Write your solution here\n    }\n}\n',
      cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    long long n;\n    cin >> n;\n    // Write your solution here\n    return 0;\n}\n',
      javascript: "const fs = require('fs');\nconst n = Number(fs.readFileSync(0, 'utf8').trim());\n// Write your solution here\n",
    }),
  },
  {
    id: 'largest-three', title: 'Largest of Three', difficulty: 'beginner',
    description: 'Read three integers and print the largest value.',
    inputFormat: 'One line containing a, b, and c.', outputFormat: 'Print the largest integer.',
    constraints: ['-1,000,000 ≤ a, b, c ≤ 1,000,000'], examples: [{ input: '8 2 14', output: '14' }],
    starter: starters({
      python: 'a, b, c = map(int, input().split())\n# Write your solution here\n',
      java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int a = in.nextInt(), b = in.nextInt(), c = in.nextInt();\n        // Write your solution here\n    }\n}\n',
      cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    long long a, b, c;\n    cin >> a >> b >> c;\n    // Write your solution here\n    return 0;\n}\n',
      javascript: "const fs = require('fs');\nconst [a, b, c] = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\n// Write your solution here\n",
    }),
  },
  {
    id: 'reverse-word', title: 'Reverse a Word', difficulty: 'beginner',
    description: 'Read a single word and print its characters in reverse order.',
    inputFormat: 'One word containing only letters.', outputFormat: 'Print the reversed word.',
    constraints: ['1 ≤ word length ≤ 100'], examples: [{ input: 'stem', output: 'mets' }],
    starter: starters({
      python: 'word = input().strip()\n# Write your solution here\n',
      java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        String word = in.next();\n        // Write your solution here\n    }\n}\n',
      cpp: '#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string word;\n    cin >> word;\n    // Write your solution here\n    return 0;\n}\n',
      javascript: "const fs = require('fs');\nconst word = fs.readFileSync(0, 'utf8').trim();\n// Write your solution here\n",
    }),
  },
  {
    id: 'count-vowels', title: 'Count the Vowels', difficulty: 'beginner',
    description: 'Count how many vowels appear in a lowercase word. The vowels are a, e, i, o, and u.',
    inputFormat: 'One lowercase word.', outputFormat: 'Print the number of vowels.',
    constraints: ['1 ≤ word length ≤ 200'], examples: [{ input: 'codegle', output: '3' }],
    starter: starters({
      python: 'word = input().strip()\n# Write your solution here\n',
      java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        String word = in.next();\n        // Write your solution here\n    }\n}\n',
      cpp: '#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string word;\n    cin >> word;\n    // Write your solution here\n    return 0;\n}\n',
      javascript: "const fs = require('fs');\nconst word = fs.readFileSync(0, 'utf8').trim();\n// Write your solution here\n",
    }),
  },
  {
    id: 'fizzbuzz-one', title: 'FizzBuzz One', difficulty: 'beginner',
    description: 'For one integer n, print FizzBuzz if divisible by both 3 and 5, Fizz if only by 3, Buzz if only by 5, or n otherwise.',
    inputFormat: 'One positive integer n.', outputFormat: 'Print the required word or number.',
    constraints: ['1 ≤ n ≤ 1,000,000'], examples: [{ input: '30', output: 'FizzBuzz' }],
    starter: starters({
      python: 'n = int(input())\n# Write your solution here\n',
      java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt();\n        // Write your solution here\n    }\n}\n',
      cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    // Write your solution here\n    return 0;\n}\n',
      javascript: "const fs = require('fs');\nconst n = Number(fs.readFileSync(0, 'utf8').trim());\n// Write your solution here\n",
    }),
  },
  {
    id: 'median-three', title: 'The Middle Number', difficulty: 'intermediate',
    description: 'Three distinct integers are given in arbitrary order. Print the value between the smallest and largest.',
    inputFormat: 'One line containing distinct integers a, b, and c.', outputFormat: 'Print the median value.',
    constraints: ['-1,000,000 ≤ a, b, c ≤ 1,000,000', 'a, b, and c are distinct'], examples: [{ input: '19 4 11', output: '11' }],
    starter: readNumbers(['a', 'b', 'c']),
  },
  {
    id: 'next-power-two', title: 'Next Power of Two', difficulty: 'intermediate',
    description: 'Print the smallest power of two that is greater than or equal to n.',
    inputFormat: 'One positive integer n.', outputFormat: 'Print the smallest power of two at least n.',
    constraints: ['1 ≤ n ≤ 1,000,000,000'], examples: [{ input: '70', output: '128' }],
    starter: readNumbers(['n']),
  },
  {
    id: 'digital-root', title: 'One-Digit Sum', difficulty: 'intermediate',
    description: 'Repeatedly add the digits of n until one digit remains. Print that final digit.',
    inputFormat: 'One non-negative decimal integer n.', outputFormat: 'Print the digital root of n.',
    constraints: ['0 ≤ n < 10¹⁰⁰'], examples: [{ input: '9875', output: '2' }],
    starter: starters({
      python: "n = input().strip()\n# Write your solution here\n",
      java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        String n = new Scanner(System.in).next();\n        // Write your solution here\n    }\n}\n',
      cpp: '#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string n; cin >> n;\n    // Write your solution here\n    return 0;\n}\n',
      javascript: "const n = require('fs').readFileSync(0, 'utf8').trim();\n// Write your solution here\n",
    }),
  },
  {
    id: 'odd-one-out', title: 'The Unpaired Number', difficulty: 'intermediate',
    description: 'Every value appears exactly twice except one. Print the value that has no pair.',
    inputFormat: 'The first line contains odd n. The second contains n non-negative integers.', outputFormat: 'Print the unpaired value.',
    constraints: ['1 ≤ n ≤ 999', '0 ≤ each value ≤ 1,000,000,000'], examples: [{ input: '7\n4 9 4 2 9 7 2', output: '7' }],
    starter: readList,
  },
  {
    id: 'triangle-kind', title: 'Name That Triangle', difficulty: 'intermediate',
    description: 'Classify three proposed side lengths. Print INVALID if they cannot form a triangle; otherwise print EQUILATERAL, ISOSCELES, or SCALENE.',
    inputFormat: 'One line containing positive side lengths a, b, and c.', outputFormat: 'Print exactly one classification word.',
    constraints: ['1 ≤ a, b, c ≤ 1,000,000'], examples: [{ input: '8 8 13', output: 'ISOSCELES' }],
    starter: readNumbers(['a', 'b', 'c']),
  },
  {
    id: 'circular-distance', title: 'Shortest Way Around', difficulty: 'intermediate',
    description: 'Positions 0 through n−1 lie on a circle. Print the fewest steps needed to travel from a to b in either direction.',
    inputFormat: 'One line containing circle size n and positions a and b.', outputFormat: 'Print the minimum number of steps.',
    constraints: ['2 ≤ n ≤ 1,000,000,000', '0 ≤ a, b < n'], examples: [{ input: '12 1 10', output: '3' }],
    starter: readNumbers(['n', 'a', 'b']),
  },
  {
    id: 'nim-winner', title: 'Last Stone Strategy', difficulty: 'advanced',
    description: 'Several piles of stones are given. Players alternate removing any positive number from one pile. The player taking the final stone wins. With perfect play, print FIRST or SECOND.',
    inputFormat: 'The first line contains n. The second contains the n pile sizes.', outputFormat: 'Print FIRST if the starting player can force a win; otherwise SECOND.',
    constraints: ['1 ≤ n ≤ 100', '1 ≤ each pile ≤ 1,000,000,000'], examples: [{ input: '3\n1 4 5', output: 'SECOND' }],
    starter: readList,
  },
  {
    id: 'factorial-zeros', title: 'Zeros at the End', difficulty: 'advanced',
    description: 'Without calculating n!, determine how many zero digits appear at the end of n factorial.',
    inputFormat: 'One non-negative integer n.', outputFormat: 'Print the number of trailing zeros in n!.',
    constraints: ['0 ≤ n ≤ 1,000,000,000'], examples: [{ input: '100', output: '24' }],
    starter: readNumbers(['n']),
  },
  {
    id: 'josephus-two', title: 'Circle Survivor', difficulty: 'advanced',
    description: 'People numbered 1 through n stand in a circle. Starting at 1, every second remaining person is removed repeatedly. Print the final survivor.',
    inputFormat: 'One positive integer n.', outputFormat: 'Print the surviving person’s number.',
    constraints: ['1 ≤ n ≤ 1,000,000,000'], examples: [{ input: '13', output: '11' }],
    starter: readNumbers(['n']),
  },
  {
    id: 'consecutive-sum', title: 'Consecutive Sum', difficulty: 'advanced',
    description: 'Decide whether n can be written as the sum of two or more consecutive positive integers.',
    inputFormat: 'One positive integer n.', outputFormat: 'Print YES if such a sum exists; otherwise NO.',
    constraints: ['1 ≤ n ≤ 1,000,000,000'], examples: [{ input: '15', output: 'YES' }],
    starter: readNumbers(['n']),
  },
  {
    id: 'last-digit-power', title: 'Last Digit of a Huge Power', difficulty: 'advanced',
    description: 'Print the final decimal digit of a raised to the power b without calculating the full power.',
    inputFormat: 'One line containing non-negative integers a and b.', outputFormat: 'Print the last digit of aᵇ. Use the standard rule that a⁰ = 1.',
    constraints: ['0 ≤ a ≤ 1,000,000,000', '0 ≤ b ≤ 1,000,000,000,000,000,000'], examples: [{ input: '7 222', output: '9' }],
    starter: starters({
      python: 'a, b = map(int, input().split())\n# Write your solution here\n',
      java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        long a = in.nextLong(), b = in.nextLong();\n        // Write your solution here\n    }\n}\n',
      cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    unsigned long long a, b; cin >> a >> b;\n    // Write your solution here\n    return 0;\n}\n',
      javascript: "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(BigInt);\n// Write your solution here\n",
    }),
  },
  {
    id: 'locker-doors', title: 'Open Locker Count', difficulty: 'advanced',
    description: 'There are n closed lockers. On pass k, every kth locker is toggled. After passes 1 through n, print how many lockers remain open.',
    inputFormat: 'One positive integer n.', outputFormat: 'Print the number of open lockers.',
    constraints: ['1 ≤ n ≤ 1,000,000,000'], examples: [{ input: '100', output: '10' }],
    starter: readNumbers(['n']),
  },
];

export function getCodegleProblem(problemId) {
  return CODEGLE_PROBLEMS.find((problem) => problem.id === problemId) || null;
}

export function getCodegleProblemForMatch(matchId, difficulty = 'beginner') {
  const candidates = CODEGLE_PROBLEMS.filter((problem) => problem.difficulty === difficulty);
  if (!candidates.length) return null;
  let hash = 2166136261;
  for (const character of `${difficulty}:${String(matchId || '')}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return candidates[(hash >>> 0) % candidates.length];
}
