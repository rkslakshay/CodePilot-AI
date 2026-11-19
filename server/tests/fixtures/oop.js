class Counter {
  constructor(name) {
    this.name = name;
    this.count = 0;
  }
  increment(by) {
    this.count += by;
    return this.count;
  }
}

const c = new Counter("clicks");
c.increment(2);
c.increment(5);
console.log(c.name + " = " + c.count);
const tags = new Set();
tags.add("js");
tags.add("py");
tags.add("js");
console.log("Tags: " + tags.size);
const prices = new Map();
prices.set("tea", 3);
prices.set("cake", 7);
let sum = 0;
for (const k of prices.keys()) {
  sum += prices.get(k);
}
console.log("Sum: " + sum);
