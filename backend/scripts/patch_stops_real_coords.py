from pathlib import Path
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient


root = Path(__file__).resolve().parents[2]
load_dotenv(root / "backend" / ".env")

mongo_url = os.environ["MONGO_URL"]
db_name = os.environ["DB_NAME"]

# Keep in sync with backend/app/core/seed.py lean_stop_master_seed (lat/lng, region, landmark).
updates = {
    "ST-HYD-ABI": ("Abids", "Abids", "", "Hyderabad", 17.3935, 78.4763),
    "ST-HYD-AFZ": ("Afzalgunj", "Afzalgunj", "", "Hyderabad", 17.3744, 78.4761),
    "ST-HYD-AME": ("Ameerpet", "Ameerpet", "Metro interchange", "Hyderabad", 17.4353, 78.4447),
    "ST-HYD-BEG": ("Begumpet", "Begumpet", "", "Hyderabad", 17.4442, 78.4708),
    "ST-HYD-BHO": ("Bhongir", "Bhongir", "", "Hyderabad", 17.51656714753325, 78.88727898775723),
    "ST-HYD-CHR": ("Charminar", "Old City", "Monument circle", "Hyderabad", 17.3616, 78.4747),
    "ST-HYD-DIL": ("Dilsukhnagar", "Dilsukhnagar", "Chandana Bros", "Hyderabad", 17.3704, 78.5254),
    "ST-HYD-GHT": ("Ghatkesar", "Ghatkesar", "ORR exit", "Hyderabad", 17.452164285002805, 78.68239941614085),
    "ST-HYD-KKP-HB": ("Kukatpally HB Colony", "Kukatpally", "Y-junction", "Hyderabad", 17.4949, 78.4002),
    "ST-HYD-KPHB": ("KPHB Colony", "Kukatpally", "Phase-3", "Hyderabad", 17.4878, 78.3955),
    "ST-HYD-LBN-RR": ("LB Nagar Ring Road", "LB Nagar", "Depot approach", "Hyderabad", 17.3507, 78.5475),
    "ST-HYD-MAL": ("Malakpet", "Malakpet", "", "Hyderabad", 17.3736, 78.4988),
    "ST-HYD-MGBS": ("MGBS", "MGBS", "Imperial", "Hyderabad", 17.3773, 78.4836),
    "ST-HYD-MYP-BS": ("Miyapur Bus Stand", "Miyapur", "Near Miyapur metro", "Hyderabad", 17.4979, 78.3617),
    "ST-HYD-PAR": ("Paradise", "Secunderabad", "Opp. railway station", "Hyderabad", 17.4417, 78.4872),
    "ST-HYD-SEC-STN": ("Secunderabad Station", "Secunderabad", "", "Hyderabad", 17.4337, 78.5016),
    "ST-HYD-SRN": ("SR Nagar", "SR Nagar", "", "Hyderabad", 17.4432, 78.4406),
    "ST-HYD-UPP-MET": ("Uppal Metro", "Uppal", "", "Hyderabad", 17.40194053306272, 78.56208812043853),
    "ST-HYD-UPP-OR": ("Uppal Ring Road", "Uppal", "NH163", "Hyderabad", 17.401812306203425, 78.56877445564773),
    "ST-HYD-WRL": ("Warangal Bus Stand", "Warangal", "GWMC", "Hyderabad", 17.9745, 79.6054),
}


def main():
    client = MongoClient(mongo_url)
    db = client[db_name]
    now = datetime.now(timezone.utc).isoformat()
    matched = 0
    modified = 0
    missing = []
    for sid, (name, locality, landmark, region, lat, lng) in updates.items():
        result = db.stop_master.update_one(
            {"stop_id": sid},
            {
                "$set": {
                    "name": name,
                    "locality": locality,
                    "landmark": landmark,
                    "region": region,
                    "lat": lat,
                    "lng": lng,
                    "updated_at": now,
                }
            },
        )
        matched += result.matched_count
        modified += result.modified_count
        if result.matched_count == 0:
            missing.append(sid)
    client.close()
    print(f"patched stops: matched={matched}, modified={modified}, missing={len(missing)}")
    print("missing_ids=" + (",".join(missing) if missing else "none"))


if __name__ == "__main__":
    main()
