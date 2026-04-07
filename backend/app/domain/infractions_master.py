"""Tender-frozen infraction master for Schedule-S + TGSRTC report heads."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class InfractionSlab:
    category: str
    amount: float
    resolve_days: int


INFRACTION_SLABS: dict[str, InfractionSlab] = {
    "A": InfractionSlab(category="A", amount=100.0, resolve_days=1),
    "B": InfractionSlab(category="B", amount=500.0, resolve_days=2),
    "C": InfractionSlab(category="C", amount=1000.0, resolve_days=3),
    "D": InfractionSlab(category="D", amount=1500.0, resolve_days=3),
    "E": InfractionSlab(category="E", amount=3000.0, resolve_days=1),
    "F": InfractionSlab(category="F", amount=10000.0, resolve_days=1),
    "G": InfractionSlab(category="G", amount=200000.0, resolve_days=1),
}

# Tender: repeat non-rectification escalation has ceiling Rs. 3,000 for A-E.
ESCALATION_CHAIN = {"A": "B", "B": "C", "C": "D", "D": "E", "E": "E"}
ESCALATION_CEILING_RS = 3000.0

TENDER_REPORT_HEADS = [
    "Double duty driver report",
    "Day wise Sch KMs,Optd Kms",
    "Daily earning report",
    "KPI report (Monthly , Quarterly)",
    "Daily cancelled KMs (Total)",
    "Head wise (cancel KMs)",
    "Daily cancelled KMs type wise",
    "Incident and penalty report",
    "Incident details report",
    "Authorized curtailment report",
    "Unauthorized curtailment report",
    "Unauthorized route deviation report",
    "Trip not started from origin",
    "Early/ Late trip started from origin Report",
    "No driver/ no conductor report",
    "Breakdown report not attended within 2 hrs.",
    "Breakdown 0.2% (As per article 16.6.3)",
    "Accident instances report",
    "Over speed report",
    "Assured KMs reconciliation report",
    "service wise infractions report",
]

# Exact tender wording from PM E-Drive Schedule-S tables A-G.
INFRACTION_MASTER = [
    # Table A
    {"code": "A01", "category": "A", "table": "A", "description": "Damaged/Missing window safety guard rails.", "safety_flag": True},
    {"code": "A02", "category": "A", "table": "A", "description": "Loose electrical wiring/ tampering with electrical wiring harness.", "safety_flag": True},
    {"code": "A03", "category": "A", "table": "A", "description": "Lack of specified fire extinguishers, empty or partially empty fire extinguishers that are beyond the date of expiry, or do not specify the expiry date.", "safety_flag": True},
    {"code": "A04", "category": "A", "table": "A", "description": "Damaged floor, steps, hatches, or hatch covers inside the bus.", "safety_flag": True},
    {"code": "A05", "category": "A", "table": "A", "description": "Missing damaged, or loosely hanging rub rails, hand grab rails, and hand holds.", "safety_flag": True},
    {"code": "A06", "category": "A", "table": "A", "description": "Missing, broken, or loosely hanging, seat belts if provided", "safety_flag": True},
    {"code": "A07", "category": "A", "table": "A", "description": "LED board defective (per board)", "safety_flag": True},
    {"code": "A08", "category": "A", "table": "A", "description": "Missing/ non operative, or blackened saloon lights, indicator lights, wiper system, wiper blades, prescribed horn and any indicating instruments (per item)", "safety_flag": True},
    {"code": "A09", "category": "A", "table": "A", "description": "Fixing any additional lights, gadgets, guards, fixtures, etc. on the exterior of the bus in contravention to the Applicable Laws.", "safety_flag": True},
    {"code": "A10", "category": "A", "table": "A", "description": "Fitment of radio, music system, or any other gadgets inside the bus in contravention to the Applicable Laws.", "safety_flag": True},
    {"code": "A11", "category": "A", "table": "A", "description": "Not stopping at authorized bus stops on the Route", "safety_flag": False},
    {"code": "A12", "category": "A", "table": "A", "description": "Delaying operation of Stage Carriage Services without cause.", "safety_flag": False},
    {"code": "A13", "category": "A", "table": "A", "description": "Parking vehicles in stations against permitted rules and regulations.", "safety_flag": False},
    {"code": "A14", "category": "A", "table": "A", "description": "Driver smoking, chewing tobacco, betel leaf while on board the bus", "safety_flag": False},
    {"code": "A15", "category": "A", "table": "A", "description": "Picking and dropping passengers at unauthorized bus stops, if no conductor provided by STU", "safety_flag": False},
    {"code": "A16", "category": "A", "table": "A", "description": "Late out of bus more than 15 minutes at the time of turn out.", "safety_flag": False},
    {"code": "A17", "category": "A", "table": "A", "description": "To operate vehicle with visible dents, damaged / torn external panels that are more than 6” in width.", "safety_flag": False},
    {"code": "A18", "category": "A", "table": "A", "description": "Oil spillage on wheel rims, hubs, tyres, etc", "safety_flag": False},
    {"code": "A19", "category": "A", "table": "A", "description": "Discoloration or unpainted repair work inside the bus or on any of its items", "safety_flag": False},
    {"code": "A20", "category": "A", "table": "A", "description": "Not maintaining USB charging ports in operating condition", "safety_flag": False},
    # Table B
    {"code": "B01", "category": "B", "table": "B", "description": "To operate with defective front, side and/or back brake lights", "safety_flag": True},
    {"code": "B02", "category": "B", "table": "B", "description": "Section of handrail loose or with sharp edges", "safety_flag": True},
    {"code": "B03", "category": "B", "table": "B", "description": "Inadequate operation of passenger access doors, either due to damage or incorrect operation which affects the boarding and alighting of passengers", "safety_flag": True},
    {"code": "B04", "category": "B", "table": "B", "description": "Defective, emergency exits and hatches or damaged or bent bumpers", "safety_flag": True},
    {"code": "B05", "category": "B", "table": "B", "description": "Parking Stage Carriage Buses in places other than those prescribed by STU", "safety_flag": False},
    {"code": "B06", "category": "B", "table": "B", "description": "Deviating from the route of a service without the prior authorization or instruction of STU/ Police without due cause", "safety_flag": False},
    {"code": "B07", "category": "B", "table": "B", "description": "Roof leakage , Surveillance system not working/ recording, CCTV defect", "safety_flag": False},
    {"code": "B08", "category": "B", "table": "B", "description": "Vehicle Tracking System defect", "safety_flag": False},
    {"code": "B09", "category": "B", "table": "B", "description": "Dirty vehicle, outside or inside, at the beginning of the journey", "safety_flag": False},
    {"code": "B10", "category": "B", "table": "B", "description": "Damaged, broken, loosely fitted, or missing passenger seats, windows Rattling", "safety_flag": False},
    {"code": "B11", "category": "B", "table": "B", "description": "Display of incorrect passenger route information, inadequately lit or illegible display of passenger information at anyof designated locations for displaying passenger information on the bus", "safety_flag": False},
    {"code": "B12", "category": "B", "table": "B", "description": "Display of slogans, posters on the bus without prior approval of STU.", "safety_flag": False},
    {"code": "B13", "category": "B", "table": "B", "description": "Running the bus with a lux level less than 70 in the saloon area", "safety_flag": False},
    # Table C
    {"code": "C01", "category": "C", "table": "C", "description": "To reduce the percentage of visual transmission of lights of safety glasses beyond normal as prescribed in Rule 100(2) of CMVR", "safety_flag": True},
    {"code": "C02", "category": "C", "table": "C", "description": "To drive with lights off in the saloon area and/or destination boards after lighting uptime", "safety_flag": True},
    {"code": "C03", "category": "C", "table": "C", "description": "Use of electronic equipment by the driver while driving (Cell Phones, Headphones/Ear-Phones, Walkman etc.)", "safety_flag": True},
    {"code": "C04", "category": "C", "table": "C", "description": "Causing minor road accidents", "safety_flag": True},
    {"code": "C05", "category": "C", "table": "C", "description": "Violation of any of the legal requirements related to registration, operation and maintenance of the buses", "safety_flag": True},
    {"code": "C06", "category": "C", "table": "C", "description": "Fitment of an Air Pressure Horn", "safety_flag": True},
    {"code": "C07", "category": "C", "table": "C", "description": "Driving the bus in a defective condition, getting battery discharged out", "safety_flag": True},
    {"code": "C08", "category": "C", "table": "C", "description": "Operating unauthorized trips such as trips which do not form part of the Schedule", "safety_flag": False},
    {"code": "C09", "category": "C", "table": "C", "description": "Tampering On-board Equipment", "safety_flag": False},
    {"code": "C10", "category": "C", "table": "C", "description": "Driver quarrelling with passenger(s) or road users or otherwise misbehavior with passengers or other road users.", "safety_flag": False},
    {"code": "C11", "category": "C", "table": "C", "description": "Operational staff working beyond authorized working hours permitted under Applicable Laws. (Unless situation demands)", "safety_flag": False},
    {"code": "C12", "category": "C", "table": "C", "description": "Breakdown / accidents- If the loss of kilometers is more than 5% of schedule kilometers of that bus on that day.", "safety_flag": False},
    {"code": "C13", "category": "C", "table": "C", "description": "Air conditioning system defective en-route (AC buses)", "safety_flag": False},
    {"code": "C14", "category": "C", "table": "C", "description": "To  use or modified colors and designs of the external paintwork of the vehicle outside the standards parameters as notified by Transport Division, STU.", "safety_flag": False},
    {"code": "C15", "category": "C", "table": "C", "description": "To place advertising material not authorized by STU or to infringe regulations regarding advertising material in vehicles.", "safety_flag": False},
    {"code": "C16", "category": "C", "table": "C", "description": "Failure to refurbish the bus after sixth year from date of put in service, per bus per day.", "safety_flag": False},
    {"code": "C17", "category": "C", "table": "C", "description": "Failure to comply with the maintenance obligations and safety requirements", "safety_flag": False},
    # Table D
    {"code": "D01", "category": "D", "table": "D", "description": "Damaged, or over worn tyres, poor quality retreading of tyres, poorly inflated tyres etc.", "safety_flag": True},
    {"code": "D02", "category": "D", "table": "D", "description": "Causing Major road accidents.", "safety_flag": True},
    {"code": "D03", "category": "D", "table": "D", "description": "Failure to deliver incident information on time, as required by STU as specified in the Operator’s Agreement", "safety_flag": True},
    {"code": "D04", "category": "D", "table": "D", "description": "To  refuse to accept the visits of STU inspectors or authorized representatives. To  hide information or to provide partial or erroneous information.", "safety_flag": True},
    {"code": "D05", "category": "D", "table": "D", "description": "Failure to provide adequate information to STU/ Police in relation to accident/s, injury to persons, damage to public / thirdparty property", "safety_flag": True},
    {"code": "D06", "category": "D", "table": "D", "description": "Misinformation or an attempt to hide anti-social incidents on the bus or accidents en-route", "safety_flag": True},
    {"code": "D07", "category": "D", "table": "D", "description": "Driver carrying weapons/arms of any kind on board the bus/ on person while on duty", "safety_flag": True},
    # Table E/F/G
    {"code": "E01", "category": "E", "table": "E", "description": "Over speeding, rash driving (driving bus beyond prescribed speed limit as notified from time to time)", "safety_flag": True},
    {"code": "E02", "category": "E", "table": "E", "description": "Driving drunk on duty or driving the bus while in a drunken state", "safety_flag": True},
    {"code": "E03", "category": "E", "table": "E", "description": "Tampering of speed governors", "safety_flag": True},
    {"code": "E04", "category": "E", "table": "E", "description": "skipping red signals, stopping the bus beyond the stop line at traffic signals", "safety_flag": True},
    {"code": "F01", "category": "F", "table": "F", "description": "“Serious nature of  breakdowns” means breakdowns in those critical systems of bus such as which may result in fire, heavy damage to bus, major injury etc.", "safety_flag": True},
    {"code": "G01", "category": "G", "table": "G", "description": "“Fatal Accidents” means any incident in which bus involved on road/ inside STU’s depot / parking premises, which causes death to passengers / pedestrians.", "safety_flag": True},
]


def build_master_rows() -> list[dict]:
    rows: list[dict] = []
    for item in INFRACTION_MASTER:
        slab = INFRACTION_SLABS[item["category"]]
        rows.append(
            {
                "id": f"INF-{item['code']}",
                "code": item["code"],
                "category": item["category"],
                "table": item["table"],
                "description": item["description"],
                "amount": slab.amount,
                "resolve_days": slab.resolve_days,
                "safety_flag": bool(item["safety_flag"]),
                "repeat_escalation": item["category"] in ESCALATION_CHAIN,
                "is_capped_non_safety": item["category"] in {"A", "B", "C", "D"} and not bool(item["safety_flag"]),
                "active": True,
            }
        )
    return rows


MASTER_BY_CODE = {r["code"]: r for r in build_master_rows()}
