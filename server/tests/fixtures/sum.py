# Sum of an array and the maximum element
def find_max(arr):
    best = arr[0]
    for i in range(1, len(arr)):
        if arr[i] > best:
            best = arr[i]
    return best


n = int(input())
arr = []
total = 0
for i in range(n):
    x = int(input())
    arr.append(x)
    total += x
avg = total / n
print("Sum:", total)
print(f"Max: {find_max(arr)}")
print(f"Average: {avg:.2f}")
if total % 2 == 0:
    print("Sum is even")
else:
    print("Sum is odd")
