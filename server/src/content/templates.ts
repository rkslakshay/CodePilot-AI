/**
 * Offline code-generation templates for common beginner / exam programs.
 * Each template is a hand-written Python reference program that reads standard input;
 * the other languages are produced by the offline translator and verified by tests.
 * These are clearly presented to users as "built-in templates", never as AI output.
 */
export interface TemplateDef {
  id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  keywords: string[];
  understanding: string;
  explanation: string;
  edgeCases: string[];
  sampleInput: string;
  tests: { input: string; expected: string }[];
  python: string;
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'even-odd',
    title: 'Check whether a number is even or odd',
    difficulty: 'Easy',
    keywords: ['even', 'odd', 'even or odd', 'parity'],
    understanding: 'Read an integer and decide whether it is divisible by 2.',
    explanation: 'A number is even when the remainder of division by 2 is 0. The modulo operator % gives that remainder.',
    edgeCases: ['0 is even', 'Negative numbers: -3 % 2 is -1 in C/Java, so compare with 0 rather than 1'],
    sampleInput: '7\n',
    tests: [
      { input: '7\n', expected: '7 is odd\n' },
      { input: '10\n', expected: '10 is even\n' },
      { input: '0\n', expected: '0 is even\n' },
    ],
    python: `n = int(input())
if n % 2 == 0:
    print(n, "is even")
else:
    print(n, "is odd")
`,
  },
  {
    id: 'prime-check',
    title: 'Check whether a number is prime',
    difficulty: 'Easy',
    keywords: ['prime', 'prime number', 'is prime', 'primality'],
    understanding: 'Read n and determine whether it has exactly two divisors (1 and itself).',
    explanation: 'Numbers below 2 are not prime. Otherwise try every divisor i from 2 while i × i ≤ n; if none divides n, it is prime. Checking only up to √n is enough because divisors come in pairs.',
    edgeCases: ['n = 0 and n = 1 are not prime', 'n = 2 is the only even prime', 'Large primes need the √n bound to stay fast'],
    sampleInput: '29\n',
    tests: [
      { input: '29\n', expected: '29 is a prime number\n' },
      { input: '1\n', expected: '1 is not a prime number\n' },
      { input: '91\n', expected: '91 is not a prime number\n' },
    ],
    python: `def is_prime(n):
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True


n = int(input())
if is_prime(n):
    print(n, "is a prime number")
else:
    print(n, "is not a prime number")
`,
  },
  {
    id: 'factorial-iter',
    title: 'Factorial of a number',
    difficulty: 'Easy',
    keywords: ['factorial', 'n!', 'product of first n'],
    understanding: 'Read n and compute n! = 1 × 2 × … × n.',
    explanation: 'Start with result = 1 and multiply by every integer from 2 to n. A 64-bit type is used because factorials overflow 32-bit integers after 12!.',
    edgeCases: ['0! = 1', 'n > 20 overflows 64-bit integers', 'Negative input has no factorial'],
    sampleInput: '5\n',
    tests: [
      { input: '5\n', expected: 'Factorial of 5 is 120\n' },
      { input: '0\n', expected: 'Factorial of 0 is 1\n' },
      { input: '15\n', expected: 'Factorial of 15 is 1307674368000\n' },
    ],
    python: `n = int(input())
result = 1
for i in range(2, n + 1):
    result = result * i
print("Factorial of", n, "is", result)
`,
  },
  {
    id: 'fibonacci-series',
    title: 'Print the Fibonacci series',
    difficulty: 'Easy',
    keywords: ['fibonacci', 'fibonacci series', 'fibonacci sequence'],
    understanding: 'Read n and print the first n Fibonacci numbers starting from 0, 1.',
    explanation: 'Keep the last two terms a and b. Print a, then compute the next term a + b and shift the pair forward. This takes O(n) time and O(1) memory.',
    edgeCases: ['n = 0 prints nothing', 'n = 1 prints only 0', 'Terms exceed 32-bit range after the 47th term'],
    sampleInput: '10\n',
    tests: [
      { input: '10\n', expected: '0 1 1 2 3 5 8 13 21 34 \n' },
      { input: '1\n', expected: '0 \n' },
    ],
    python: `n = int(input())
a = 0
b = 1
for i in range(n):
    print(a, end=" ")
    c = a + b
    a = b
    b = c
print()
`,
  },
  {
    id: 'reverse-number',
    title: 'Reverse the digits of a number',
    difficulty: 'Easy',
    keywords: ['reverse a number', 'reverse number', 'reverse digits', 'reverse of number'],
    understanding: 'Read a non-negative integer and print its digits in reverse order.',
    explanation: 'Repeatedly take the last digit with n % 10, append it to the reversed value (rev = rev × 10 + digit) and drop it from n with integer division by 10.',
    edgeCases: ['Trailing zeros disappear (120 → 21)', 'n = 0 gives 0', 'Negative numbers need their sign handled separately'],
    sampleInput: '12345\n',
    tests: [
      { input: '12345\n', expected: 'Reversed number: 54321\n' },
      { input: '120\n', expected: 'Reversed number: 21\n' },
    ],
    python: `n = int(input())
rev = 0
while n > 0:
    digit = n % 10
    rev = rev * 10 + digit
    n = n // 10
print("Reversed number:", rev)
`,
  },
  {
    id: 'palindrome-number',
    title: 'Check whether a number is a palindrome',
    difficulty: 'Easy',
    keywords: ['palindrome', 'palindrome number', 'number palindrome'],
    understanding: 'A palindrome number reads the same forwards and backwards (e.g. 121).',
    explanation: 'Reverse the digits of a copy of n and compare the reversed value with the original.',
    edgeCases: ['Single-digit numbers are palindromes', 'Numbers ending in 0 (except 0) are never palindromes'],
    sampleInput: '121\n',
    tests: [
      { input: '121\n', expected: '121 is a palindrome\n' },
      { input: '123\n', expected: '123 is not a palindrome\n' },
    ],
    python: `n = int(input())
original = n
rev = 0
while n > 0:
    rev = rev * 10 + n % 10
    n = n // 10
if rev == original:
    print(original, "is a palindrome")
else:
    print(original, "is not a palindrome")
`,
  },
  {
    id: 'sum-digits',
    title: 'Sum of digits of a number',
    difficulty: 'Easy',
    keywords: ['sum of digits', 'digit sum', 'add digits'],
    understanding: 'Read an integer and add up its decimal digits.',
    explanation: 'Extract the last digit with % 10, add it to the total and remove it with // 10 until the number becomes 0.',
    edgeCases: ['n = 0 → 0', 'Negative numbers: use the absolute value'],
    sampleInput: '4096\n',
    tests: [
      { input: '4096\n', expected: 'Sum of digits: 19\n' },
      { input: '7\n', expected: 'Sum of digits: 7\n' },
    ],
    python: `n = int(input())
total = 0
while n > 0:
    total += n % 10
    n = n // 10
print("Sum of digits:", total)
`,
  },
  {
    id: 'gcd-lcm',
    title: 'GCD and LCM of two numbers',
    difficulty: 'Easy',
    keywords: ['gcd', 'hcf', 'lcm', 'greatest common divisor', 'least common multiple', 'euclid'],
    understanding: 'Read two positive integers and compute their greatest common divisor and least common multiple.',
    explanation: "Euclid's algorithm: gcd(a, b) = gcd(b, a mod b) until b becomes 0. Then lcm(a, b) = a / gcd × b (dividing first avoids overflow).",
    edgeCases: ['gcd(a, 0) = a', 'Very large values can overflow the LCM'],
    sampleInput: '12 18\n',
    tests: [
      { input: '12 18\n', expected: 'GCD = 6\nLCM = 36\n' },
      { input: '7 13\n', expected: 'GCD = 1\nLCM = 91\n' },
    ],
    python: `def gcd(a, b):
    while b != 0:
        r = a % b
        a = b
        b = r
    return a


a, b = map(int, input().split())
g = gcd(a, b)
print("GCD =", g)
print("LCM =", a // g * b)
`,
  },
  {
    id: 'largest-of-three',
    title: 'Largest of three numbers',
    difficulty: 'Easy',
    keywords: ['largest of three', 'greatest of three', 'maximum of three', 'biggest of three', 'largest among three'],
    understanding: 'Read three numbers and print the largest one.',
    explanation: 'Compare the numbers with if / else-if conditions: the first is largest if it is ≥ both others, otherwise compare the remaining two.',
    edgeCases: ['Equal values', 'Negative numbers'],
    sampleInput: '12 45 7\n',
    tests: [
      { input: '12 45 7\n', expected: 'Largest number is 45\n' },
      { input: '-1 -5 -3\n', expected: 'Largest number is -1\n' },
    ],
    python: `a, b, c = map(int, input().split())
if a >= b and a >= c:
    largest = a
elif b >= c:
    largest = b
else:
    largest = c
print("Largest number is", largest)
`,
  },
  {
    id: 'sum-average',
    title: 'Sum and average of n numbers',
    difficulty: 'Easy',
    keywords: ['sum and average', 'average of n numbers', 'mean', 'sum of n numbers', 'average'],
    understanding: 'Read n followed by n numbers; print their sum, average, minimum and maximum.',
    explanation: 'Accumulate the total in a loop while tracking the smallest and largest value. The average is total / n computed in floating point.',
    edgeCases: ['n = 0 would divide by zero', 'Use a floating-point division for the average'],
    sampleInput: '5\n4\n8\n15\n16\n23\n',
    tests: [{ input: '5\n4\n8\n15\n16\n23\n', expected: 'Sum = 66\nAverage = 13.20\nMinimum = 4\nMaximum = 23\n' }],
    python: `n = int(input())
total = 0
smallest = 0
largest = 0
for i in range(n):
    x = int(input())
    total += x
    if i == 0 or x < smallest:
        smallest = x
    if i == 0 or x > largest:
        largest = x
avg = total / n
print("Sum =", total)
print(f"Average = {avg:.2f}")
print("Minimum =", smallest)
print("Maximum =", largest)
`,
  },
  {
    id: 'leap-year',
    title: 'Leap year check',
    difficulty: 'Easy',
    keywords: ['leap year', 'leap'],
    understanding: 'Determine whether a given year is a leap year in the Gregorian calendar.',
    explanation: 'A year is a leap year if it is divisible by 4 but not by 100, or if it is divisible by 400.',
    edgeCases: ['1900 is not a leap year', '2000 is a leap year'],
    sampleInput: '2024\n',
    tests: [
      { input: '2024\n', expected: '2024 is a leap year\n' },
      { input: '1900\n', expected: '1900 is not a leap year\n' },
      { input: '2000\n', expected: '2000 is a leap year\n' },
    ],
    python: `year = int(input())
if (year % 4 == 0 and year % 100 != 0) or year % 400 == 0:
    print(year, "is a leap year")
else:
    print(year, "is not a leap year")
`,
  },
  {
    id: 'armstrong',
    title: 'Armstrong number check',
    difficulty: 'Medium',
    keywords: ['armstrong', 'armstrong number', 'narcissistic'],
    understanding: 'An Armstrong number equals the sum of its digits each raised to the power of the number of digits (153 = 1³ + 5³ + 3³).',
    explanation: 'First count the digits, then add digit^count for every digit and compare with the original number.',
    edgeCases: ['All single-digit numbers are Armstrong numbers', 'Powers grow quickly — use integer arithmetic'],
    sampleInput: '153\n',
    tests: [
      { input: '153\n', expected: '153 is an Armstrong number\n' },
      { input: '123\n', expected: '123 is not an Armstrong number\n' },
      { input: '9474\n', expected: '9474 is an Armstrong number\n' },
    ],
    python: `n = int(input())
digits = 0
temp = n
while temp > 0:
    digits += 1
    temp = temp // 10
total = 0
temp = n
while temp > 0:
    d = temp % 10
    p = 1
    for i in range(digits):
        p = p * d
    total += p
    temp = temp // 10
if total == n:
    print(n, "is an Armstrong number")
else:
    print(n, "is not an Armstrong number")
`,
  },
  {
    id: 'temperature',
    title: 'Celsius to Fahrenheit conversion',
    difficulty: 'Easy',
    keywords: ['celsius', 'fahrenheit', 'temperature', 'convert temperature'],
    understanding: 'Convert a temperature from Celsius to Fahrenheit.',
    explanation: 'Apply F = C × 9 / 5 + 32 using floating-point arithmetic.',
    edgeCases: ['-40 °C equals -40 °F', 'Use floating point to keep fractions'],
    sampleInput: '37.5\n',
    tests: [
      { input: '37.5\n', expected: '37.50 C = 99.50 F\n' },
      { input: '-40\n', expected: '-40.00 C = -40.00 F\n' },
    ],
    python: `c = float(input())
f = c * 9 / 5 + 32
print(f"{c:.2f} C = {f:.2f} F")
`,
  },
  {
    id: 'multiplication-table',
    title: 'Multiplication table',
    difficulty: 'Easy',
    keywords: ['multiplication table', 'times table', 'table of'],
    understanding: 'Print the multiplication table of n from 1 to 10.',
    explanation: 'A counting loop from 1 to 10 prints n × i on each line.',
    edgeCases: ['Negative n', 'Large n may overflow for big tables'],
    sampleInput: '7\n',
    tests: [{ input: '3\n', expected: '3 x 1 = 3\n3 x 2 = 6\n3 x 3 = 9\n3 x 4 = 12\n3 x 5 = 15\n3 x 6 = 18\n3 x 7 = 21\n3 x 8 = 24\n3 x 9 = 27\n3 x 10 = 30\n' }],
    python: `n = int(input())
for i in range(1, 11):
    print(n, "x", i, "=", n * i)
`,
  },
  {
    id: 'array-max-min',
    title: 'Maximum and minimum in an array',
    difficulty: 'Easy',
    keywords: ['maximum element', 'largest element', 'minimum element', 'smallest element', 'max and min', 'largest in array', 'find max'],
    understanding: 'Read n numbers into an array and find the largest and smallest values with their positions.',
    explanation: 'Assume the first element is both the maximum and minimum, then scan the rest and update whenever a larger or smaller value appears.',
    edgeCases: ['n = 1', 'All elements equal', 'All negative values'],
    sampleInput: '6\n12\n-4\n45\n7\n45\n0\n',
    tests: [{ input: '6\n12\n-4\n45\n7\n45\n0\n', expected: 'Maximum: 45 at index 2\nMinimum: -4 at index 1\n' }],
    python: `n = int(input())
arr = [0] * n
for i in range(n):
    arr[i] = int(input())
max_i = 0
min_i = 0
for i in range(1, n):
    if arr[i] > arr[max_i]:
        max_i = i
    if arr[i] < arr[min_i]:
        min_i = i
print("Maximum:", arr[max_i], "at index", max_i)
print("Minimum:", arr[min_i], "at index", min_i)
`,
  },
  {
    id: 'reverse-array',
    title: 'Reverse an array in place',
    difficulty: 'Easy',
    keywords: ['reverse an array', 'reverse array', 'reverse the array', 'reverse list'],
    understanding: 'Read n numbers and reverse their order without a second array.',
    explanation: 'Swap the elements at the two ends and move both indexes toward the middle until they meet (two-pointer technique).',
    edgeCases: ['Odd length keeps the middle element in place', 'n = 0 or 1'],
    sampleInput: '5\n1\n2\n3\n4\n5\n',
    tests: [{ input: '5\n1\n2\n3\n4\n5\n', expected: '5 4 3 2 1 \n' }],
    python: `n = int(input())
arr = [0] * n
for i in range(n):
    arr[i] = int(input())
left = 0
right = n - 1
while left < right:
    temp = arr[left]
    arr[left] = arr[right]
    arr[right] = temp
    left += 1
    right -= 1
for i in range(n):
    print(arr[i], end=" ")
print()
`,
  },
  {
    id: 'power',
    title: 'Power of a number (a^b)',
    difficulty: 'Easy',
    keywords: ['power of a number', 'exponent', 'a raised to b', 'a^b', 'power'],
    understanding: 'Compute a raised to the power b for a non-negative integer exponent.',
    explanation: 'Multiply the result by a, b times. (Fast exponentiation could reduce this to O(log b).)',
    edgeCases: ['b = 0 gives 1', 'Large results overflow fixed-size integers'],
    sampleInput: '2 10\n',
    tests: [{ input: '2 10\n', expected: '2^10 = 1024\n' }],
    python: `a, b = map(int, input().split())
result = 1
for i in range(b):
    result = result * a
print(f"{a}^{b} = {result}")
`,
  },
  {
    id: 'sum-natural',
    title: 'Sum of first n natural numbers',
    difficulty: 'Easy',
    keywords: ['sum of natural numbers', 'sum of first n', '1 to n sum', 'natural numbers'],
    understanding: 'Compute 1 + 2 + … + n.',
    explanation: 'A loop adds every number from 1 to n; the result is checked against the closed formula n(n + 1) / 2.',
    edgeCases: ['n = 0 gives 0', 'Large n needs a 64-bit result'],
    sampleInput: '100\n',
    tests: [{ input: '100\n', expected: 'Sum = 5050\nFormula check = 5050\n' }],
    python: `n = int(input())
total = 0
for i in range(1, n + 1):
    total += i
print("Sum =", total)
print("Formula check =", n * (n + 1) // 2)
`,
  },
  {
    id: 'swap-numbers',
    title: 'Swap two numbers',
    difficulty: 'Easy',
    keywords: ['swap two numbers', 'swap', 'interchange'],
    understanding: 'Read two numbers and exchange their values.',
    explanation: 'Store the first value in a temporary variable, copy the second into the first, then copy the temporary into the second.',
    edgeCases: ['Equal values', 'XOR swap fails when both refer to the same memory location'],
    sampleInput: '5 9\n',
    tests: [{ input: '5 9\n', expected: 'Before swap: a = 5, b = 9\nAfter swap: a = 9, b = 5\n' }],
    python: `a, b = map(int, input().split())
print(f"Before swap: a = {a}, b = {b}")
temp = a
a = b
b = temp
print(f"After swap: a = {a}, b = {b}")
`,
  },
  {
    id: 'simple-interest',
    title: 'Simple interest',
    difficulty: 'Easy',
    keywords: ['simple interest', 'interest', 'principal rate time'],
    understanding: 'Compute simple interest from principal, rate (% per year) and time (years).',
    explanation: 'SI = P × R × T / 100; the total amount is P + SI.',
    edgeCases: ['Zero rate or time', 'Use floating point for fractional rates'],
    sampleInput: '10000 7.5 3\n',
    tests: [{ input: '10000 7.5 3\n', expected: 'Simple interest = 2250.00\nTotal amount = 12250.00\n' }],
    python: `p, r, t = map(float, input().split())
si = p * r * t / 100
print(f"Simple interest = {si:.2f}")
print(f"Total amount = {p + si:.2f}")
`,
  },
  {
    id: 'star-pattern',
    title: 'Right-angled triangle star pattern',
    difficulty: 'Easy',
    keywords: ['star pattern', 'pattern', 'triangle pattern', 'pyramid', 'print stars'],
    understanding: 'Print a right-angled triangle of n rows where row i has i stars.',
    explanation: 'An outer loop selects the row and an inner loop prints that many stars, followed by a newline.',
    edgeCases: ['n = 0 prints nothing'],
    sampleInput: '4\n',
    tests: [{ input: '4\n', expected: '*\n**\n***\n****\n' }],
    python: `n = int(input())
for i in range(1, n + 1):
    for j in range(i):
        print("*", end="")
    print()
`,
  },
  {
    id: 'count-digits',
    title: 'Count the digits of a number',
    difficulty: 'Easy',
    keywords: ['count digits', 'number of digits', 'how many digits'],
    understanding: 'Count how many decimal digits a non-negative integer has.',
    explanation: 'Divide by 10 repeatedly and count the iterations; 0 is treated as having one digit.',
    edgeCases: ['n = 0 has one digit'],
    sampleInput: '987654\n',
    tests: [
      { input: '987654\n', expected: 'Number of digits: 6\n' },
      { input: '0\n', expected: 'Number of digits: 1\n' },
    ],
    python: `n = int(input())
count = 0
if n == 0:
    count = 1
while n > 0:
    count += 1
    n = n // 10
print("Number of digits:", count)
`,
  },
  {
    id: 'grade-calculator',
    title: 'Grade calculator',
    difficulty: 'Easy',
    keywords: ['grade', 'marks', 'grade calculator', 'percentage', 'result'],
    understanding: 'Read marks (0–100) and print the corresponding grade.',
    explanation: 'An if / else-if ladder checks the ranges from highest to lowest: 90+ → A, 75+ → B, 60+ → C, 40+ → D, otherwise F.',
    edgeCases: ['Boundary values 90, 75, 60, 40', 'Invalid marks outside 0–100'],
    sampleInput: '82\n',
    tests: [
      { input: '82\n', expected: 'Grade: B\n' },
      { input: '95\n', expected: 'Grade: A\n' },
      { input: '30\n', expected: 'Grade: F\n' },
    ],
    python: `marks = int(input())
if marks < 0 or marks > 100:
    print("Invalid marks")
elif marks >= 90:
    print("Grade: A")
elif marks >= 75:
    print("Grade: B")
elif marks >= 60:
    print("Grade: C")
elif marks >= 40:
    print("Grade: D")
else:
    print("Grade: F")
`,
  },
];
