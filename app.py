"""
NourishSync AI - Food Donor & Intake Agent
Aligned with UN SDG 2 (Zero Hunger) and SDG 12 (Responsible Consumption)
"""

from flask import Flask, request, jsonify, render_template
from datetime import datetime, timezone
import uuid
import math

app = Flask(__name__)

# ---------------------------------------------------------------------------
# In-Memory Data Store
# ---------------------------------------------------------------------------
donations: list[dict] = []
alerts: list[dict] = []

# ---------------------------------------------------------------------------
# AI Shelf-Life & Safety Estimation Engine
# ---------------------------------------------------------------------------

SHELF_LIFE_HOURS: dict[str, dict[str, float]] = {
    "Restaurant":        {"Hot": 4.0,  "Ambient": 3.0,  "Refrigerated": 24.0},
    "Banquet/Wedding":   {"Hot": 3.5,  "Ambient": 2.5,  "Refrigerated": 20.0},
    "Corporate Canteen": {"Hot": 4.0,  "Ambient": 3.5,  "Refrigerated": 28.0},
    "Cloud Kitchen":     {"Hot": 5.0,  "Ambient": 4.0,  "Refrigerated": 30.0},
}

MEAL_PENALTY: dict[str, float] = {
    "Non-Veg": 0.75,
    "Veg":     1.0,
}


def estimate_shelf_life(
    category: str,
    storage: str,
    meal_type: str,
    cooking_timestamp: datetime,
) -> dict:
    """
    Returns remaining safe hours and a Perishability Risk level.
    Risk levels: Low (>50 % remaining), Medium (20–50 %), Critical (<20 %)
    """
    base_hours = SHELF_LIFE_HOURS.get(category, {}).get(storage, 4.0)
    adjusted_hours = base_hours * MEAL_PENALTY.get(meal_type, 1.0)

    now = datetime.now(timezone.utc)
    if cooking_timestamp.tzinfo is None:
        cooking_timestamp = cooking_timestamp.replace(tzinfo=timezone.utc)

    elapsed_hours = (now - cooking_timestamp).total_seconds() / 3600.0
    remaining_hours = max(0.0, adjusted_hours - elapsed_hours)
    ratio = remaining_hours / adjusted_hours if adjusted_hours > 0 else 0.0

    if ratio > 0.50:
        risk = "Low"
    elif ratio > 0.20:
        risk = "Medium"
    else:
        risk = "Critical"

    return {
        "total_safe_hours": round(adjusted_hours, 2),
        "elapsed_hours": round(elapsed_hours, 2),
        "remaining_hours": round(remaining_hours, 2),
        "perishability_risk": risk,
    }


# ---------------------------------------------------------------------------
# Helper: alert logger
# ---------------------------------------------------------------------------

def push_alert(donation: dict, shelf: dict) -> None:
    level = shelf["perishability_risk"]
    if level in ("Medium", "Critical"):
        msg = (
            f"[{level.upper()} ALERT] '{donation['food_name']}' from "
            f"{donation['donor_name']} ({donation['category']}) — "
            f"{shelf['remaining_hours']}h remaining. "
            f"Pincode: {donation['pincode']}."
        )
        alerts.append({
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "message": msg,
        })
        # Keep only the 50 most recent alerts
        if len(alerts) > 50:
            alerts.pop(0)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/metrics")
def api_metrics():
    total_rescued = sum(
        d.get("quantity", 0) for d in donations if d["status"] != "Expired"
    )
    active_posts = sum(1 for d in donations if d["status"] == "Available")
    verified_claims = sum(1 for d in donations if d["status"] in ("Claimed", "Dispatched"))
    critical_count = sum(
        1 for d in donations if d["shelf_life"]["perishability_risk"] == "Critical"
    )
    total = len(donations) or 1
    critical_rate = round((critical_count / total) * 100, 1)

    return jsonify({
        "total_rescued": round(total_rescued, 1),
        "active_posts": active_posts,
        "verified_claims": verified_claims,
        "critical_expiry_rate": critical_rate,
    })


@app.route("/api/donate", methods=["POST"])
def api_donate():
    data = request.get_json(silent=True) or {}

    required = ["donor_name", "category", "food_name", "quantity",
                "meal_type", "cooking_timestamp", "storage", "pincode"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    try:
        cooking_ts = datetime.fromisoformat(data["cooking_timestamp"])
    except ValueError:
        return jsonify({"error": "Invalid cooking_timestamp. Use ISO 8601 format."}), 400

    try:
        quantity = float(data["quantity"])
        if quantity <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "quantity must be a positive number."}), 400

    shelf = estimate_shelf_life(
        category=data["category"],
        storage=data["storage"],
        meal_type=data["meal_type"],
        cooking_timestamp=cooking_ts,
    )

    donation = {
        "id": str(uuid.uuid4()),
        "donor_name": data["donor_name"],
        "category": data["category"],
        "food_name": data["food_name"],
        "quantity": quantity,
        "meal_type": data["meal_type"],
        "cooking_timestamp": cooking_ts.isoformat(),
        "storage": data["storage"],
        "pincode": data["pincode"],
        "address": data.get("address", ""),
        "status": "Available",
        "shelf_life": shelf,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    donations.append(donation)
    push_alert(donation, shelf)

    return jsonify({"success": True, "donation": donation}), 201


@app.route("/api/donations")
def api_donations():
    # Re-evaluate shelf life dynamically so risk badges stay current
    result = []
    for d in reversed(donations):
        try:
            cooking_ts = datetime.fromisoformat(d["cooking_timestamp"])
        except ValueError:
            cooking_ts = datetime.now(timezone.utc)

        shelf = estimate_shelf_life(
            category=d["category"],
            storage=d["storage"],
            meal_type=d["meal_type"],
            cooking_timestamp=cooking_ts,
        )
        d["shelf_life"] = shelf

        # Auto-expire if no time left and still "Available"
        if shelf["remaining_hours"] == 0 and d["status"] == "Available":
            d["status"] = "Expired"

        result.append(d)

    return jsonify(result)


@app.route("/api/claim/<donation_id>", methods=["POST"])
def api_claim(donation_id: str):
    for d in donations:
        if d["id"] == donation_id:
            if d["status"] != "Available":
                return jsonify({"error": f"Donation is already '{d['status']}'."}), 409
            d["status"] = "Claimed"
            return jsonify({"success": True, "donation": d})
    return jsonify({"error": "Donation not found."}), 404


@app.route("/api/alerts")
def api_alerts():
    return jsonify(list(reversed(alerts)))


# ---------------------------------------------------------------------------
# Seed data (optional — comment out for clean start)
# ---------------------------------------------------------------------------

def _seed():
    import random
    samples = [
        ("Annapoorna Restaurant", "Restaurant", "Vegetable Biryani", 18, "Veg", "Hot"),
        ("Grand Wedding Hall", "Banquet/Wedding", "Paneer Butter Masala", 35, "Veg", "Ambient"),
        ("TechCorp Canteen", "Corporate Canteen", "Chicken Curry", 22, "Non-Veg", "Refrigerated"),
        ("CloudBite Kitchen", "Cloud Kitchen", "Dal Tadka", 12, "Veg", "Hot"),
        ("Spice Route", "Restaurant", "Mutton Rogan Josh", 8, "Non-Veg", "Ambient"),
    ]
    for i, (donor, cat, food, qty, meal, storage) in enumerate(samples):
        hours_ago = random.uniform(0.5, 3.5)
        ts = datetime.now(timezone.utc).replace(microsecond=0)
        from datetime import timedelta
        cooking_ts = ts - timedelta(hours=hours_ago)
        shelf = estimate_shelf_life(cat, storage, meal, cooking_ts)
        d = {
            "id": str(uuid.uuid4()),
            "donor_name": donor,
            "category": cat,
            "food_name": food,
            "quantity": qty,
            "meal_type": meal,
            "cooking_timestamp": cooking_ts.isoformat(),
            "storage": storage,
            "pincode": f"5600{10 + i}",
            "address": f"{i+1}, Sample Street, City",
            "status": "Available",
            "shelf_life": shelf,
            "created_at": ts.isoformat(),
        }
        donations.append(d)
        push_alert(d, shelf)


_seed()

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, port=5000)
