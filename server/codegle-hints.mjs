const HINTS = new Map(Object.entries({
  'sum-two': [
    'Use the addition operator on the two parsed values.',
    'Print the result directly; no loop is needed.',
  ],
  'even-or-odd': [
    'The remainder after division by 2 identifies parity.',
    'Check n % 2 and print exactly EVEN or ODD.',
  ],
  'largest-three': [
    'Compare all three values, or use a built-in maximum.',
    'Only one value needs to be printed.',
  ],
  'reverse-word': [
    'A string can be traversed from its last character to its first.',
    'Many languages provide a reverse operation or slicing syntax.',
  ],
  'count-vowels': [
    'Test each character against the set a, e, i, o, u.',
    'Count matches while scanning the word once.',
  ],
  'fizzbuzz-one': [
    'Check divisibility by both 3 and 5 before either one alone.',
    'Use remainders and preserve the required capitalization.',
  ],
  'median-three': [
    'The middle value is the total sum minus the minimum and maximum.',
    'You do not need to fully sort three values.',
  ],
  'next-power-two': [
    'Start at 1 and repeatedly double until the value reaches n.',
    'The first power that is greater than or equal to n is the answer.',
  ],
  'digital-root': [
    'A nonzero number’s digital root depends on its remainder modulo 9.',
    'Handle zero separately; otherwise the result follows 1 + (n - 1) mod 9.',
  ],
  'odd-one-out': [
    'A value XORed with itself becomes zero.',
    'XOR every number; the paired values cancel each other.',
  ],
  'triangle-kind': [
    'Validate the triangle inequality before comparing equal sides.',
    'After validity, count whether three, two, or no side lengths are equal.',
  ],
  'circular-distance': [
    'First compute the direct distance d = |a - b|.',
    'The route around the other side has length n - d; take the smaller.',
  ],
  'nim-winner': [
    'A losing position in normal Nim has zero XOR across all piles.',
    'XOR every pile; zero means SECOND and any other result means FIRST.',
  ],
  'factorial-zeros': [
    'Each trailing zero needs a factor pair 2 × 5, and factors of 5 are rarer.',
    'Add floor(n/5) + floor(n/25) + floor(n/125) and continue while needed.',
  ],
  'josephus-two': [
    'For step size 2, find the largest power of two that does not exceed n.',
    'If n = 2^k + remainder, the survivor is 2 × remainder + 1.',
  ],
  'consecutive-sum': [
    'The positive integers that cannot be written this way are powers of two.',
    'A positive power of two satisfies n & (n - 1) = 0.',
  ],
  'last-digit-power': [
    'Last digits repeat in short cycles.',
    'Use modular exponentiation with modulus 10, remembering exponent zero.',
  ],
  'locker-doors': [
    'Only lockers with an odd number of divisors stay open.',
    'Perfect squares have an odd divisor count, so count squares up to n.',
  ],
}));

export const CODEGLE_HINT_PENALTY_MS = 10_000;

export function codegleHints(problemId) {
  return HINTS.get(problemId) || [];
}
