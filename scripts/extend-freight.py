"""Regenerate synthetic freight charges while preserving intentional settlement defects."""

import csv
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1] / "examples/freight"
ZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
]


def read_rows(name):
    with (ROOT / name).open(newline="") as stream:
        return [row for row in csv.DictReader(stream) if int(row["Load ID"][1:]) <= 140]


def money(minor):
    absolute = abs(minor)
    return ("-" if minor < 0 else "") + f"{absolute // 100}.{absolute % 100:02}"


def write_rows(name, rows, fields):
    with (ROOT / name).open("w", newline="") as stream:
        writer = csv.DictWriter(
            stream, fieldnames=fields, extrasaction="ignore", lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(rows)


loads = read_rows("tms-loads.csv")
rate = read_rows("rate-confirmation-lines.csv")
settlement = read_rows("carrier-settlement-lines.csv")
settlement.append(
    {
        "Load ID": "L999",
        "Tender ID": "VOID",
        "Charge": "fuel",
        "Amount": "invalid ignored amount",
        "Status": "void",
        "Delivered at": "2026-11-02T14:40:00Z",
        "Posting": "void",
    }
)

for index in range(41, 121):
    load = f"L{100 + index}"
    instant = datetime(
        2026, 11, 1, 1, 30,
        tzinfo=ZoneInfo(ZONES[index % 4]),
        fold=(index // 4) % 2,
    ).isoformat()
    charges = [("linehaul", 75000 + index * 137), ("fuel", 15000 + index * 37)]
    for divisor, kind, amount in [
        (3, "detention", [4500, 7500, 12500, 18750][(index // 3) % 4]),
        (5, "lumper", [18500, 22500, 31250][(index // 5) % 3]),
        (7, "layover", [25000, 35000, 42500][(index // 7) % 3]),
        (11, "tonu", 25000),
        (13, "claim_deduction", [-7500, -12000, -16850][(index // 13) % 3]),
    ]:
        if index % divisor == 0:
            charges.append((kind, amount))
    cancelled = index % 11 == 0
    if cancelled:
        charges = [("tonu", 25000)]
        instant = ""
    loads.append(
        {
            "Load ID": load,
            "Tender ID": f"T{9000 + index}",
            "Carrier pay": money(sum(amount for _, amount in charges)),
            "Status": "cancelled" if cancelled else "delivered",
            "Delivered at": instant,
            "Posting": "posted",
        }
    )
    for kind, amount in charges:
        row = {
            "Load ID": load,
            "Tender ID": f"T{9000 + index}",
            "Charge": kind,
            "Amount": money(amount),
            "Status": "cancelled" if cancelled else "delivered",
            "Delivered at": instant,
            "Posting": "posted",
        }
        rate.append(dict(row))
        if (load, kind) != ("L155", "tonu"):
            settlement.append(dict(row))

# An unconfirmed stop is extra; the missing TONU remains unpaid.
settlement.append(
    {
        "Load ID": "L150",
        "Tender ID": "T9050",
        "Charge": "stop",
        "Amount": "35.00",
        "Status": "cancelled" if cancelled else "delivered",
        "Delivered at": next(row["Delivered at"] for row in loads if row["Load ID"] == "L150"),
        "Posting": "posted",
    }
)
# Carry the facility zone as display metadata; explicit timestamp offsets remain authoritative.
for rows in [loads, settlement]:
    for row in rows:
        row["Facility zone"] = ZONES[(int(row["Load ID"][1:]) - 100) % 4]
# Replace the original artificial detention ramp with varied commercial amounts, preserving defects.
for row in rate:
    if row["Charge"] == "detention" and int(row["Load ID"][1:]) <= 140:
        old = row["Amount"]
        new = money([4500, 7500, 12500, 18750][int(row["Load ID"][1:]) % 4])
        row["Amount"] = new
        delta = round((float(new) - float(old)) * 100)
        for load_row in loads:
            if load_row["Load ID"] == row["Load ID"]:
                load_row["Carrier pay"] = money(round(float(load_row["Carrier pay"]) * 100) + delta)
        for line in settlement:
            if line["Load ID"] == row["Load ID"] and line["Charge"] == "detention":
                line["Amount"] = money(round(float(line["Amount"]) * 100) + delta)
write_rows("tms-loads.csv", loads, list(loads[0]))
write_rows(
    "rate-confirmation-lines.csv", rate,
    ["Load ID", "Tender ID", "Charge", "Amount", "Posting"],
)
write_rows("carrier-settlement-lines.csv", settlement, list(settlement[0]))
print(f"{len(loads)} loads, {len(rate)} confirmed charges, {len(settlement)} settlement rows including voids")
