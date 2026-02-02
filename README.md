# homebridge-smart-diffuser-lbslm

Homebridge plugin for Smart Diffusers using the LBSLM / UPerfume cloud platform (e.g., "Smart Diffuser" app).

## Features
- **Power Control:** Turn the diffuser on or off.
- **Intensity Control:** Adjust mist density using the Fan Rotation Speed (mapped to "Run Time" seconds).
- **Status Monitoring:**
  - **Oil Level:** Mapped to Filter Life Level (reports low oil).
  - **Child Lock:** Reports physical lock status.
- **Auto-Discovery:** Automatically finds your device using LBSLM Cloud credentials.

## HomeKit Mapping
| HomeKit Characteristic | Diffuser Function | Notes |
|------------------------|-------------------|-------|
| **Switch / Fan On**    | Power On/Off      | |
| **Rotation Speed**     | Intensity (Run Time)| 0-100% maps to 5s-300s run duration. |
| **Filter Life Level**  | Oil Level         | 0-100% (Approximated). |
| **Filter Change**      | Low Oil Warning   | Triggers when oil < 10%. |
| **Lock Physical**      | Child Lock Status | Read-only status. |

## Configuration

You supply the username and password for the [LBSLM web dashboard](http://amos.cn.lbslm.com/).

```json
{
    "platform": "SmartDiffuserLBSLM",
    "email": "your_email@example.com",
    "password": "your_password"
}
```
