"""Extend the static synthetic carrier-settlement fixture, preserving its reviewed defects."""
import csv
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
root = Path(__file__).resolve().parents[1] / 'examples/freight'
def read(name):
    with (root / name).open(newline='') as stream:
        return list(csv.DictReader(stream))
loads = [row for row in read('tms-loads.csv') if int(row['Load ID'][1:]) <= 140]
rate = [row for row in read('rate-confirmation-lines.csv') if int(row['Load ID'][1:]) <= 140]
settlement = [row for row in read('carrier-settlement-lines.csv') if int(row['Load ID'][1:]) <= 140]
settlement.append({'Load ID':'L999','Tender ID':'VOID','Charge':'fuel','Amount':'invalid ignored amount','Status':'void','Delivered at':'2026-11-02T14:40:00Z','Posting':'void'})
zones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles']
for i in range(41, 121):
    load = f'L{100+i}'
    instant = datetime(2026, 11, 1, 1, 30, tzinfo=ZoneInfo(zones[i % 4]), fold=(i // 4) % 2).isoformat()
    charges = [('linehaul', 75000 + i*137), ('fuel', 15000 + i*37)]
    for divisor, kind, amount in [(3,'detention',4500),(5,'lumper',18500),(7,'layover',25000),(11,'tonu',25000),(13,'claim_deduction',-7500)]:
        if i % divisor == 0: charges.append((kind, amount))
    loads.append({'Load ID':load, 'Tender ID':f'T{9000+i}', 'Carrier pay':f'{sum(amount for _,amount in charges)/100:.2f}', 'Status':'delivered', 'Delivered at':instant, 'Posting':'posted'})
    for kind, amount in charges:
        row = {'Load ID':load,'Tender ID':f'T{9000+i}','Charge':kind,'Amount':f'{amount/100:.2f}','Status':'delivered','Delivered at':instant,'Posting':'posted'}
        rate.append(dict(row))
        if (load,kind) != ('L155','tonu'): settlement.append(dict(row))
# A posted unconfirmed lumper is an extra charge; a missing TONU remains unpaid.
settlement.append({'Load ID':'L150','Tender ID':'T9050','Charge':'stop','Amount':'35.00','Status':'delivered','Delivered at':next(row['Delivered at'] for row in loads if row['Load ID']=='L150'),'Posting':'posted'})
for name, rows, fields in [('tms-loads.csv',loads,list(loads[0])),('rate-confirmation-lines.csv',rate,['Load ID','Tender ID','Charge','Amount','Posting']),('carrier-settlement-lines.csv',settlement,list(settlement[0]))]:
    with (root/name).open('w',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields,extrasaction='ignore',lineterminator='\n');writer.writeheader();writer.writerows(rows)
print(f'{len(loads)} loads, {len(rate)} confirmed charges, {len(settlement)} settlement rows including voids')
