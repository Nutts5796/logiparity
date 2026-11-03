"""Extend static carrier settlements while preserving the reviewed first 40 loads."""

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
        (3, "detention", 4500),
        (5, "lumper", 18500),
        (7, "layover", 25000),
        (11, "tonu", 25000),
        (13, "claim_deduction", -7500),
    ]:
        if index % divisor == 0:
            charges.append((kind, amount))
    loads.append(
        {
            "Load ID": load,
            "Tender ID": f"T{9000 + index}",
            "Carrier pay": money(sum(amount for _, amount in charges)),
            "Status": "delivered",
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
            "Status": "delivered",
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
        "Status": "delivered",
        "Delivered at": next(row["Delivered at"] for row in loads if row["Load ID"] == "L150"),
        "Posting": "posted",
    }
)
write_rows("tms-loads.csv", loads, list(loads[0]))
write_rows(
    "rate-confirmation-lines.csv", rate,
    ["Load ID", "Tender ID", "Charge", "Amount", "Posting"],
)
write_rows("carrier-settlement-lines.csv", settlement, list(settlement[0]))
print(f"{len(loads)} loads, {len(rate)} confirmed charges, {len(settlement)} settlement rows including voids")
