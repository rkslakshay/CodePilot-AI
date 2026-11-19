import java.util.Scanner;

public class Main {
    // Sum of an array and the maximum element
    static int findMax(int[] arr) {
        int best = arr[0];
        for (int i = 1; i < arr.length; i++) {
            if (arr[i] > best) best = arr[i];
        }
        return best;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] arr = new int[n];
        int sum = 0;
        for (int i = 0; i < n; i++) {
            arr[i] = sc.nextInt();
            sum += arr[i];
        }
        double avg = (double) sum / n;
        System.out.println("Sum: " + sum);
        System.out.println("Max: " + findMax(arr));
        System.out.printf("Average: %.2f\n", avg);
        if (sum % 2 == 0) {
            System.out.println("Sum is even");
        } else {
            System.out.println("Sum is odd");
        }
    }
}
