def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)


def is_prime(n):
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True


def bubble_sort(arr, n):
    for i in range(n - 1):
        swapped = False
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                temp = arr[j]
                arr[j] = arr[j + 1]
                arr[j + 1] = temp
                swapped = True
        if not swapped:
            break


nums = [64, 34, 25, 12, 22, 11, 90]
bubble_sort(nums, 7)
for x in nums:
    print(x, end=" ")
print()
print("5! =", factorial(5))
count = 0
for k in range(1, 30):
    if is_prime(k):
        count += 1
print("Primes below 30:", count)
word = "level"
left = 0
right = len(word) - 1
ok = True
while left < right:
    if word[left] != word[right]:
        ok = False
        break
    left += 1
    right -= 1
label = "palindrome" if ok else "not palindrome"
print(word, "is", label)
total = 0
for d in range(10, 0, -2):
    total += d // 3
print("Total:", total)
