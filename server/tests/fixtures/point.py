class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def move(self, dx, dy):
        self.x += dx
        self.y += dy

    def dist2(self):
        return self.x * self.x + self.y * self.y


p = Point(3, 4)
print("dist2:", p.dist2())
p.move(1, -2)
print("moved:", p.x, p.y)
print("dist2:", p.dist2())
