s = "  Hello, World  "
t = s.strip()
print(t.upper())
print(t.lower())
print(t.replace("World", "There"))
print(t.find("World"))
if t.startswith("Hello"):
    print("starts ok")
print(t[0:5])
parts = "a,b,c".split(",")
print(len(parts), "-".join(parts))
