class Account:
    def __init__(self, owner, balance):
        self.owner = owner
        self.balance = balance
        self.history = []

    def deposit(self, amount):
        if amount <= 0:
            raise ValueError("Deposit must be positive")
        self.balance += amount
        self.history.append(amount)

    def withdraw(self, amount):
        if amount > self.balance:
            raise ValueError("Insufficient funds")
        self.balance -= amount
        self.history.append(-amount)
        return self.balance

    def describe(self):
        return self.owner + ": " + str(self.balance)


acc = Account("Asha", 100)
acc.deposit(50)
print(acc.describe())
try:
    acc.withdraw(500)
except ValueError as e:
    print("Error:", e)
left = acc.withdraw(30)
print("Left:", left)
print("Transactions:", len(acc.history))
print(acc.describe())
