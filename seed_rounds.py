#!/usr/bin/env python3
import json
import urllib.request
import urllib.error
import random
from datetime import date

SUPABASE_URL = "https://euwqnyzzrxrmldmfspjr.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1d3FueXp6cnhybWxkbWZzcGpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMDA4MywiZXhwIjoyMDkwMTA2MDgzfQ.l3H3N-DdotJZa5hm78fVKpcQopcgM84-dNZQslPeHOU"
MEMBER_NUMBER = "1931-4763"

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

def api_get(path):
    req = urllib.request.Request(SUPABASE_URL + path, headers=HEADERS, method="GET")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def api_post(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(SUPABASE_URL + path, data=body, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print("Error:", e.read())
        raise

# Look up user_id from member number
profiles = api_get(f"/rest/v1/profiles?member_number=eq.{MEMBER_NUMBER}&select=id")
if not profiles:
    print(f"No user found with member number {MEMBER_NUMBER}")
    exit(1)
user_id = profiles[0]["id"]
print(f"Found user: {user_id}")

courses = [
    {"name": "Lakewood Country Club", "rating": 72.4, "slope": 131},
    {"name": "Riverside Golf Club",   "rating": 71.8, "slope": 127},
    {"name": "The Highlands",         "rating": 73.2, "slope": 138},
    {"name": "Meadow Valley GC",      "rating": 70.5, "slope": 119},
    {"name": "Pinecrest CC",          "rating": 74.1, "slope": 143},
]

# (year, month, avg_differential, std_dev)
# Arc: 2-3 hcp → +2 hcp → 5-6 hcp over 12 months
monthly_plan = [
    (2025,  8,  3.0, 1.5),  # Starting ~3 hcp
    (2025,  9,  2.5, 1.4),  # Settling in
    (2025, 10,  1.5, 1.3),  # Getting hot
    (2025, 11,  0.3, 1.2),  # Near scratch
    (2025, 12, -1.2, 1.1),  # Plus territory
    (2026,  1, -2.0, 1.0),  # Peak: +2
    (2026,  2, -0.5, 1.2),  # Decline begins
    (2026,  3,  1.5, 1.3),  # Trending up
    (2026,  4,  3.2, 1.4),  # Getting worse
    (2026,  5,  4.5, 1.4),  # Continued decline
    (2026,  6,  5.5, 1.5),  # Approaching 6
    (2026,  7,  6.0, 1.5),  # At 5-6 hcp
]

rounds = []
random.seed(42)

for year, month, avg_diff, std in monthly_plan:
    next_month = month + 1 if month < 12 else 1
    next_year = year if month < 12 else year + 1
    days_in_month = (date(next_year, next_month, 1) - date(year, month, 1)).days

    days = sorted(random.sample(range(1, days_in_month + 1), 10))

    for day in days:
        course = random.choice(courses)
        diff = random.gauss(avg_diff, std)
        score = round(course["rating"] + diff * (course["slope"] / 113))
        actual_diff = round((score - course["rating"]) * (113 / course["slope"]), 2)

        rounds.append({
            "user_id": user_id,
            "course": course["name"],
            "score": score,
            "rating": course["rating"],
            "slope": course["slope"],
            "date": f"{year:04d}-{month:02d}-{day:02d}",
            "differential": actual_diff,
        })

print(f"Inserting {len(rounds)} rounds...")
result = api_post("/rest/v1/rounds", rounds)
print(f"Done. Inserted {len(result)} rounds.")
