#!/usr/bin/env python3
import json
import urllib.request
import urllib.error

SUPABASE_URL = "https://euwqnyzzrxrmldmfspjr.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1d3FueXp6cnhybWxkbWZzcGpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMDA4MywiZXhwIjoyMDkwMTA2MDgzfQ.l3H3N-DdotJZa5hm78fVKpcQopcgM84-dNZQslPeHOU"

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
        print("  Error:", e.read().decode())
        raise

COURSE = {"name": "Riverside Golf Club", "rating": 71.8, "slope": 127}

def make_round(user_id, score, date_str, hour=10, minute=0, second=0):
    diff = round((score - COURSE["rating"]) * 113 / COURSE["slope"], 2)
    created_at = f"{date_str}T{hour:02d}:{minute:02d}:{second:02d}Z"
    return {
        "user_id": user_id,
        "course": COURSE["name"],
        "score": score,
        "rating": COURSE["rating"],
        "slope": COURSE["slope"],
        "date": date_str,
        "differential": diff,
        "created_at": created_at,
    }

def insert_rounds(uid, rounds_data, label):
    print(f"  {label}:")
    for i, (date_str, score, hour) in enumerate(rounds_data):
        r = make_round(uid, score, date_str, hour=hour, minute=i+1, second=(i*7) % 60)
        api_post("/rest/v1/rounds", r)
        diff = round((score - COURSE["rating"]) * 113 / COURSE["slope"], 2)
        print(f"    {date_str}  score {score}  diff {diff:+.1f}")

# ─── Member 2863-1103 ───────────────────────────────────────────────────────
# Arc: ~8 hcp historically → cold streak → hot streak → new all-time low score

profiles1 = api_get("/rest/v1/profiles?member_number=eq.2863-1103&select=id")
if not profiles1:
    print("ERROR: Member 2863-1103 not found"); exit(1)
uid1 = profiles1[0]["id"]
print(f"\nMember 2863-1103 → {uid1}")

# 22 historical rounds (scores 80-87, all-time low = 80 so new low of 72 is genuine)
hist1 = [
    ("2025-08-06", 85, 9), ("2025-08-20", 83, 9), ("2025-09-03", 87, 9), ("2025-09-17", 81, 9),
    ("2025-10-01", 84, 9), ("2025-10-15", 82, 9), ("2025-11-05", 86, 9), ("2025-11-19", 80, 9),
    ("2025-12-03", 85, 9), ("2025-12-17", 83, 9), ("2026-01-07", 87, 9), ("2026-01-21", 81, 9),
    ("2026-02-04", 84, 9), ("2026-02-18", 82, 9), ("2026-03-04", 86, 9), ("2026-03-18", 83, 9),
    ("2026-04-01", 85, 9), ("2026-04-15", 82, 9), ("2026-05-06", 84, 9), ("2026-05-20", 80, 9),
    ("2026-06-03", 83, 9), ("2026-06-17", 85, 9),
]

# Cold streak — 3 rounds, scores well above ~8 hcp expectation (~81)
cold1 = [
    ("2026-08-05", 90, 8),
    ("2026-08-07", 91, 8),
    ("2026-08-09", 89, 8),
]

# Hot streak — 3 rounds trending down, then all-time low score
hot1 = [
    ("2026-08-11", 76, 8),
    ("2026-08-13", 74, 8),
    ("2026-08-15", 73, 8),
    ("2026-08-17", 72, 8),  # all-time low score (historical min was 80)
]

insert_rounds(uid1, hist1, "Historical — 22 rounds (~8 hcp)")
insert_rounds(uid1, cold1, "Cold streak — Aug 5/7/9 (bad scores, hcp rising)")
insert_rounds(uid1, hot1,  "Hot streak + new low score — Aug 11-17")

# ─── Member 6836-3939 ───────────────────────────────────────────────────────
# Arc: ~5 hcp historically → hot streak → new all-time low hcp → cold streak

profiles2 = api_get("/rest/v1/profiles?member_number=eq.6836-3939&select=id")
if not profiles2:
    print("ERROR: Member 6836-3939 not found"); exit(1)
uid2 = profiles2[0]["id"]
print(f"\nMember 6836-3939 → {uid2}")

# 22 historical rounds (scores 76-82, establishing ~5 hcp)
hist2 = [
    ("2025-08-06", 80, 9), ("2025-08-20", 78, 9), ("2025-09-03", 82, 9), ("2025-09-17", 77, 9),
    ("2025-10-01", 79, 9), ("2025-10-15", 81, 9), ("2025-11-05", 78, 9), ("2025-11-19", 76, 9),
    ("2025-12-03", 80, 9), ("2025-12-17", 79, 9), ("2026-01-07", 82, 9), ("2026-01-21", 77, 9),
    ("2026-02-04", 79, 9), ("2026-02-18", 81, 9), ("2026-03-04", 78, 9), ("2026-03-18", 80, 9),
    ("2026-04-01", 77, 9), ("2026-04-15", 79, 9), ("2026-05-06", 81, 9), ("2026-05-20", 78, 9),
    ("2026-06-03", 80, 9), ("2026-06-17", 76, 9),
]

# Hot streak — 3 sub-par rounds, each driving hcp to new all-time low
hot2 = [
    ("2026-08-05", 73, 8),
    ("2026-08-07", 72, 8),
    ("2026-08-09", 71, 8),  # sub-par — new all-time low handicap
]

# Cold streak — 4 terrible rounds, hcp climbing back up
cold2 = [
    ("2026-08-11", 87, 8),
    ("2026-08-13", 89, 8),
    ("2026-08-15", 88, 8),
    ("2026-08-17", 90, 8),
]

insert_rounds(uid2, hist2, "Historical — 22 rounds (~5 hcp)")
insert_rounds(uid2, hot2,  "Hot streak + new low hcp — Aug 5/7/9")
insert_rounds(uid2, cold2, "Cold streak — Aug 11-17 (bad scores, hcp rising)")

print("\n✓ Done. Add both members as partners in the app to see all feed events.")
print("  Feed covers: ⛳ rounds  📉 hcp down  📈 hcp up  🔥 hot  ❄️ cold  🏆 low score  🏆 low hcp")
