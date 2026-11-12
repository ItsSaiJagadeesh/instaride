# Notice (GPL-3.0-or-later)

InstaRide is a modified version of **RideFlow**, an open-source ride-sharing app released under the
GNU General Public License v3.0 or later. The original licence text is in `LICENSE` and applies to
this whole project, including all changes.

## What changed from RideFlow

- Three roles renamed: Super Admin (admin), InstaRider (books rides), InstaDriver (drives).
- Login by 10-digit mobile number; passwords hashed with scrypt; signed login tokens; every API route
  now checks who is calling and what they are allowed to do.
- Removed the default `admin` / `admin123` account: the Super Admin is created from environment
  variables on first start.
- Money in rupees, distance in kilometres, whole-rupee fares, per-vehicle-type rate cards.
- The 82% driver share was replaced by a flat per-ride platform fee paid by the driver (default ₹5),
  with a fee ledger, an unpaid-dues limit and manual settlement by the Super Admin.
- Manual driver verification: photo uploads, Super Admin review with a VAHAN checklist, expiry dates,
  automatic offline on expiry.
- 4-digit start code, one-active-ride rules, service-area limit, atomic ride acceptance, admin audit log.
- Removed the code that auto-started a Redis daemon; Redis is now configured with `REDIS_URL`.

Original work: RideFlow authors. Changes: InstaRide.

## Mappls Maps SDK
The Android map uses `mappls-map-react-native` (MIT licence, by Mappls / MapmyIndia). Use of the Mappls service is governed by Mappls's API terms
and conditions. The Mappls logo and copyright must remain visible in the app.
