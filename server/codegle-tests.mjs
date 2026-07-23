const TESTS = {
  'sum-two': [
    ['7 11\n', '18'], ['-8 3\n', '-5'], ['0 0\n', '0'], ['999999 1\n', '1000000'],
  ],
  'even-or-odd': [
    ['17\n', 'ODD'], ['42\n', 'EVEN'], ['0\n', 'EVEN'], ['-9\n', 'ODD'],
  ],
  'largest-three': [
    ['8 2 14\n', '14'], ['-8 -2 -14\n', '-2'], ['5 5 1\n', '5'], ['0 99 4\n', '99'],
  ],
  'reverse-word': [
    ['stem\n', 'mets'], ['a\n', 'a'], ['racecar\n', 'racecar'], ['Codegle\n', 'elgedoC'],
  ],
  'count-vowels': [
    ['codegle\n', '3'], ['rhythm\n', '0'], ['aeiou\n', '5'], ['mississippi\n', '4'],
  ],
  'fizzbuzz-one': [
    ['30\n', 'FizzBuzz'], ['9\n', 'Fizz'], ['25\n', 'Buzz'], ['7\n', '7'],
  ],
  'median-three': [
    ['19 4 11\n', '11'], ['-9 20 0\n', '0'], ['3 1 2\n', '2'], ['1000000 -1000000 5\n', '5'],
  ],
  'next-power-two': [
    ['70\n', '128'], ['1\n', '1'], ['1024\n', '1024'], ['1025\n', '2048'], ['1000000000\n', '1073741824'],
  ],
  'digital-root': [
    ['9875\n', '2'], ['0\n', '0'], ['9\n', '9'], ['999999999999999999999999999999\n', '9'],
  ],
  'odd-one-out': [
    ['7\n4 9 4 2 9 7 2\n', '7'], ['1\n42\n', '42'], ['5\n0 3 3 9 9\n', '0'],
    ['9\n100 7 5 100 5 8 7 12 8\n', '12'],
  ],
  'triangle-kind': [
    ['8 8 13\n', 'ISOSCELES'], ['5 5 5\n', 'EQUILATERAL'], ['3 4 5\n', 'SCALENE'],
    ['1 2 3\n', 'INVALID'], ['10 2 2\n', 'INVALID'],
  ],
  'circular-distance': [
    ['12 1 10\n', '3'], ['10 2 8\n', '4'], ['100 50 50\n', '0'], ['9 0 8\n', '1'],
  ],
  'nim-winner': [
    ['3\n1 4 5\n', 'SECOND'], ['1\n7\n', 'FIRST'], ['4\n1 1 1 1\n', 'SECOND'], ['3\n2 2 3\n', 'FIRST'],
  ],
  'factorial-zeros': [
    ['100\n', '24'], ['0\n', '0'], ['5\n', '1'], ['25\n', '6'], ['1000000000\n', '249999998'],
  ],
  'josephus-two': [
    ['13\n', '11'], ['1\n', '1'], ['8\n', '1'], ['10\n', '5'], ['1000\n', '977'],
  ],
  'consecutive-sum': [
    ['15\n', 'YES'], ['8\n', 'NO'], ['1\n', 'NO'], ['9\n', 'YES'], ['1024\n', 'NO'], ['999999999\n', 'YES'],
  ],
  'last-digit-power': [
    ['7 222\n', '9'], ['2 0\n', '1'], ['0 0\n', '1'], ['10 999\n', '0'], ['3 1000000000000000000\n', '1'],
  ],
  'locker-doors': [
    ['100\n', '10'], ['1\n', '1'], ['2\n', '1'], ['15\n', '3'], ['1000000000\n', '31622'],
  ],
};

export function codegleTests(problemId) {
  return (TESTS[problemId] || []).map(([input, expected]) => ({ input, expected }));
}
