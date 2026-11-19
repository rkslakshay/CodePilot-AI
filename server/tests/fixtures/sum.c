#include <stdio.h>

// Sum of an array and the maximum element
int findMax(int arr[], int n) {
    int best = arr[0];
    for (int i = 1; i < n; i++) {
        if (arr[i] > best) {
            best = arr[i];
        }
    }
    return best;
}

int main() {
    int n;
    scanf("%d", &n);
    int arr[100];
    int sum = 0;
    for (int i = 0; i < n; i++) {
        scanf("%d", &arr[i]);
        sum += arr[i];
    }
    double avg = (double) sum / n;
    printf("Sum: %d\n", sum);
    printf("Max: %d\n", findMax(arr, n));
    printf("Average: %.2f\n", avg);
    if (sum % 2 == 0) {
        printf("Sum is even\n");
    } else {
        printf("Sum is odd\n");
    }
    return 0;
}
