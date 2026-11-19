words = "the quick brown fox jumps over the lazy dog the end".split()
counts = {}
for w in words:
    if w in counts:
        counts[w] += 1
    else:
        counts[w] = 1
for w in sorted(counts):
    print(w, counts[w])
seen = set()
for w in words:
    seen.add(w)
print("Unique:", len(seen))
if "fox" in seen:
    print("fox found")
ages = {"ann": 31, "bob": 27}
ages["cy"] = 45
total = 0
for name in ages:
    total += ages[name]
print("Total age:", total)
