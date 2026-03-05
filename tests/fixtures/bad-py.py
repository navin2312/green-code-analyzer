# =================================================================
# bad-py.py — Sample file containing Python energy anti-patterns
# Used by the test suite to verify detection accuracy.
# =================================================================

import time
import pandas as pd
import functools

# PY001 — String concatenation in loop
def build_csv(rows):
    result = ''
    for row in rows:
        result += str(row['name']) + ',' + str(row['value']) + '\n'
    return result

# PY002 — pandas iterrows (very slow)
def sum_totals(df):
    total = 0
    for idx, row in df.iterrows():
        total += row['qty'] * row['price']
    return total

# PY003 — range(len()) instead of enumerate
def print_items(items):
    for i in range(len(items)):
        print(f"{i}: {items[i]}")

# PY004 — Busy-wait spin loop without adequate sleep
def poll_for_work():
    while True:
        job = fetch_next_job()
        if job:
            process(job)
        # no sleep — burns 100% CPU!

# PY005 — Reading entire file into memory
def count_lines(filename):
    with open(filename) as f:
        lines = f.readlines()   # loads everything at once
    return len(lines)

# PY006 — Recursive without memoisation
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)   # O(2^n) recomputation

# PY007 — list.append in loop
def transform(data):
    result = []
    for x in data:
        result.append(x * 2)
    return result

# PY008 — Empty collection created inside loop
def process_batches(batches):
    for batch in batches:
        tmp = []
        for item in batch:
            tmp.append(item)
        yield tmp

# PY009 — pandas itertuples
def calc_total(df):
    return sum(row.qty * row.price for row in df.itertuples())

# PY010 — Nested loops (O(n²))
def find_duplicates(list_a, list_b):
    matches = []
    for a in list_a:
        for b in list_b:
            if a == b:
                matches.append(a)
    return matches

# PY012 — Repeated len() call in while condition
def process_queue(items):
    i = 0
    while i < len(items):   # len() called every iteration
        process(items[i])
        i += 1
