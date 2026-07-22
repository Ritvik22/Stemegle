export const CODEGLE_LANGUAGES = [
  { id: 'python', label: 'Python', extension: 'py' },
  { id: 'java', label: 'Java', extension: 'java' },
  { id: 'cpp', label: 'C++', extension: 'cpp' },
  { id: 'javascript', label: 'JavaScript', extension: 'js' },
];

const starters = ({ python, java, cpp, javascript }) => ({ python, java, cpp, javascript });

export const CODEGLE_PROBLEMS = [
  {
    id: 'sum-two', title: 'Add Two Numbers', difficulty: 'Easy',
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
    id: 'even-or-odd', title: 'Even or Odd', difficulty: 'Easy',
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
    id: 'largest-three', title: 'Largest of Three', difficulty: 'Easy',
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
    id: 'reverse-word', title: 'Reverse a Word', difficulty: 'Easy',
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
    id: 'count-vowels', title: 'Count the Vowels', difficulty: 'Easy',
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
    id: 'fizzbuzz-one', title: 'FizzBuzz One', difficulty: 'Easy',
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
];

export function getCodegleProblem(problemId) {
  return CODEGLE_PROBLEMS.find((problem) => problem.id === problemId) || null;
}

export function getCodegleProblemForMatch(matchId) {
  let hash = 2166136261;
  for (const character of String(matchId || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return CODEGLE_PROBLEMS[(hash >>> 0) % CODEGLE_PROBLEMS.length];
}
