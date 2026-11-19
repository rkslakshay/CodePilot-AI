import java.util.*;

public class Main {
    static class Node {
        int val;
        Node next;

        Node(int val) {
            this.val = val;
            this.next = null;
        }
    }

    static class LinkedStack {
        Node top;
        int size;

        void push(int v) {
            Node n = new Node(v);
            n.next = top;
            top = n;
            size++;
        }

        int pop() {
            if (top == null) {
                throw new IllegalStateException("empty stack");
            }
            int v = top.val;
            top = top.next;
            size--;
            return v;
        }
    }

    public static void main(String[] args) {
        LinkedStack s = new LinkedStack();
        for (int i = 1; i <= 4; i++) {
            s.push(i * 10);
        }
        System.out.println("Size: " + s.size);
        System.out.println("Popped: " + s.pop());
        System.out.println("Popped: " + s.pop());
        Map<String, Integer> stock = new HashMap<>();
        stock.put("apple", 5);
        stock.put("pear", 2);
        stock.put("apple", stock.get("apple") + 3);
        System.out.println("Apples: " + stock.get("apple"));
        System.out.println("Has kiwi: " + stock.containsKey("kiwi"));
        try {
            s.pop();
            s.pop();
            s.pop();
        } catch (IllegalStateException e) {
            System.out.println("Caught: " + e.getMessage());
        }
    }
}
