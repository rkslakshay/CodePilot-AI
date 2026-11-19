// Sum of an array and the maximum element
function findMax(arr) {
  let best = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > best) best = arr[i];
  }
  return best;
}

const data = [4, 8, 15, 16, 23];
let sum = 0;
for (const x of data) {
  sum += x;
}
const avg = sum / data.length;
console.log("Sum: " + sum);
console.log(`Max: ${findMax(data)}`);
console.log("Average: " + avg.toFixed(2));
if (sum % 2 === 0) {
  console.log("Sum is even");
} else {
  console.log("Sum is odd");
}
