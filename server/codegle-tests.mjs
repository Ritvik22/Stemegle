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
};

export function codegleTests(problemId) {
  return (TESTS[problemId] || []).map(([input, expected]) => ({ input, expected }));
}
