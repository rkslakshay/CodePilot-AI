#include <iostream>
#include <vector>
#include <iomanip>
using namespace std;

// Sum of an array and the maximum element
int findMax(vector<int>& arr) {
    int best = arr[0];
    for (int i = 1; i < arr.size(); i++) {
        if (arr[i] > best) best = arr[i];
    }
    return best;
}

int main() {
    int n;
    cin >> n;
    vector<int> arr(n);
    int sum = 0;
    for (int i = 0; i < n; i++) {
        cin >> arr[i];
        sum += arr[i];
    }
    double avg = (double) sum / n;
    cout << "Sum: " << sum << endl;
    cout << "Max: " << findMax(arr) << endl;
    cout << "Average: " << fixed << setprecision(2) << avg << endl;
    if (sum % 2 == 0) {
        cout << "Sum is even" << endl;
    } else {
        cout << "Sum is odd" << endl;
    }
    return 0;
}
