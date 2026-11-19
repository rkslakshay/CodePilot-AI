public class Main {
    static long factorial(int n) {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
    }

    static boolean isPrime(int n) {
        if (n < 2) return false;
        for (int i = 2; i * i <= n; i++) {
            if (n % i == 0) return false;
        }
        return true;
    }

    static void bubbleSort(int[] arr) {
        int n = arr.length;
        for (int i = 0; i < n - 1; i++) {
            boolean swapped = false;
            for (int j = 0; j < n - 1 - i; j++) {
                if (arr[j] > arr[j + 1]) {
                    int temp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = temp;
                    swapped = true;
                }
            }
            if (!swapped) break;
        }
    }

    public static void main(String[] args) {
        int[] nums = {64, 34, 25, 12, 22, 11, 90};
        bubbleSort(nums);
        for (int x : nums) {
            System.out.print(x + " ");
        }
        System.out.println();
        System.out.println("5! = " + factorial(5));
        int count = 0;
        for (int k = 1; k < 30; k++) {
            if (isPrime(k)) count++;
        }
        System.out.println("Primes below 30: " + count);
        String word = "level";
        int left = 0, right = word.length() - 1;
        boolean ok = true;
        while (left < right) {
            if (word.charAt(left) != word.charAt(right)) {
                ok = false;
                break;
            }
            left++;
            right--;
        }
        String label = ok ? "palindrome" : "not palindrome";
        System.out.println(word + " is " + label);
        int total = 0;
        for (int d = 10; d > 0; d -= 2) {
            total += d / 3;
        }
        System.out.println("Total: " + total);
        int grade = 85;
        switch (grade / 10) {
            case 10:
            case 9:
                System.out.println("A");
                break;
            case 8:
                System.out.println("B");
                break;
            default:
                System.out.println("C");
        }
    }
}
